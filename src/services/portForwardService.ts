import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { portForwards, quotas } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { pfsenseClient } from '../lib/infrastructure';

const PORT_RANGE_START = Number(process.env.PFSENSE_PORT_RANGE_START || 1000);
const PORT_RANGE_END = Number(process.env.PFSENSE_PORT_RANGE_END || 9999);

// Private RFC-1918 ranges only — prevents forwarding to loopback, pfSense mgmt, or public IPs
const PRIVATE_IP_RE = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/;
const VALID_PROTOCOLS = ['tcp', 'udp', 'tcp/udp'] as const;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validateInput(params: {
  internalIp: string;
  internalPort: number;
  externalPort?: number;
  protocol?: string;
  description?: string;
}): void {
  if (!PRIVATE_IP_RE.test(params.internalIp)) {
    throw new ValidationError('internal_ip must be a private IP address (RFC 1918)');
  }

  if (!Number.isInteger(params.internalPort) || params.internalPort < 1 || params.internalPort > 65535) {
    throw new ValidationError('internal_port must be an integer between 1 and 65535');
  }

  if (params.externalPort !== undefined) {
    if (!Number.isInteger(params.externalPort) || params.externalPort < PORT_RANGE_START || params.externalPort > PORT_RANGE_END) {
      throw new ValidationError(`external_port must be between ${PORT_RANGE_START} and ${PORT_RANGE_END}`);
    }
  }

  if (params.protocol && !VALID_PROTOCOLS.includes(params.protocol as any)) {
    throw new ValidationError(`protocol must be one of: ${VALID_PROTOCOLS.join(', ')}`);
  }

  if (params.description && params.description.length > 255) {
    throw new ValidationError('description must be 255 characters or less');
  }
}

async function allocateExternalPort(requestedPort?: number): Promise<number> {
  const used = await db
    .select({ external_port: portForwards.external_port })
    .from(portForwards);
  const usedSet = new Set(used.map(r => r.external_port));

  if (requestedPort !== undefined) {
    if (usedSet.has(requestedPort)) {
      throw new ValidationError(`External port ${requestedPort} is already in use`);
    }
    return requestedPort;
  }

  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!usedSet.has(p)) return p;
  }
  throw new Error('No available external ports in configured range');
}

async function checkQuota(ownerId?: string): Promise<void> {
  if (!ownerId) return; // ownerId 가 없으면 쿼터 체크 생략 (관리자용)

  const quotaResult = await db.select().from(quotas).where(eq(quotas.owner_id, ownerId));
  const limit = quotaResult[0]?.max_public_ports ?? 10;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(portForwards)
    .where(eq(portForwards.owner_id, ownerId));
  const current = Number(countResult[0]?.count || 0);

  if (current >= limit) {
    throw new ValidationError(`Port forwarding quota exceeded (${current}/${limit})`);
  }
}

export const portForwardService = {
  async list(ownerId?: string) {
    if (ownerId) {
      return db.select().from(portForwards).where(eq(portForwards.owner_id, ownerId));
    }
    // ownerId 없이 호출 시 전체 반환 (관리자용)
    return db.select().from(portForwards);
  },

  async create(params: {
    ownerId?: string;
    vmId?: string;
    internalIp: string;
    internalPort: number;
    externalPort?: number;
    protocol?: string;
    description?: string;
  }) {
    validateInput(params);
    await checkQuota(params.ownerId);

    const protocol = params.protocol || 'tcp';

    // 동시 요청으로 같은 외부 포트가 동시에 할당되는 race 처리:
    // 사용자가 명시적으로 포트를 지정하지 않은 경우(자동 배정)에 한해 최대 5번 재시도.
    const maxAttempts = params.externalPort === undefined ? 5 : 1;
    let lastError: any = null;
    let attemptedPorts = new Set<number>();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const externalPort = await allocateExternalPort(params.externalPort);

      // 같은 포트로 다시 시도되는 무한 루프 방지 (자동 배정에서 다른 후보를 고를 수 있도록)
      if (params.externalPort === undefined && attemptedPorts.has(externalPort)) {
        await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
      }
      attemptedPorts.add(externalPort);

      // Create rule in pfSense first
      const result = await pfsenseClient.addPortForward({
        internalIp: params.internalIp,
        internalPort: params.internalPort,
        externalPort,
        protocol,
        description: params.description,
      });

      // Persist to DB — if duplicate port (race), rollback pfSense and retry with next port
      const id = uuidv4();
      try {
        await db.insert(portForwards).values({
          id,
          vm_id: params.vmId || null,
          owner_id: params.ownerId || null,
          protocol,
          internal_ip: params.internalIp,
          internal_port: params.internalPort,
          external_ip: result.externalIp,
          external_port: externalPort,
          pfsense_tracker: result.tracker,
          description: params.description || null,
        });
      } catch (dbError: any) {
        try {
          await pfsenseClient.deletePortForward(result.tracker);
        } catch (rollbackErr) {
          console.error('[PortForward] pfSense rollback failed after DB error:', rollbackErr);
        }
        if (dbError.code === 'ER_DUP_ENTRY' && attempt < maxAttempts - 1) {
          console.warn(`[PortForward] external_port ${externalPort} race — retry ${attempt + 1}/${maxAttempts - 1}`);
          lastError = dbError;
          continue;
        }
        if (dbError.code === 'ER_DUP_ENTRY') {
          throw new ValidationError(`External port ${externalPort} was taken by a concurrent request. Retry.`);
        }
        throw dbError;
      }

      // 성공
      return {
        id,
        internal_ip: params.internalIp,
        internal_port: params.internalPort,
        external_ip: result.externalIp,
        external_port: externalPort,
        protocol,
        description: params.description,
      };
    }

    throw lastError ?? new Error('PortForward create: exhausted retries');
  },

  async delete(id: string) {
    const rows = await db.select().from(portForwards).where(eq(portForwards.id, id));

    if (rows.length === 0) return false;

    const rule = rows[0];
    if (rule.pfsense_tracker) {
      await pfsenseClient.deletePortForward(rule.pfsense_tracker);
    }

    await db.delete(portForwards).where(eq(portForwards.id, id));
    return true;
  },

  async countByOwner(ownerId?: string): Promise<number> {
    if (!ownerId) {
      const result = await db.select({ count: sql<number>`count(*)` }).from(portForwards);
      return Number(result[0]?.count || 0);
    }
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(portForwards)
      .where(eq(portForwards.owner_id, ownerId));
    return Number(result[0]?.count || 0);
  },
};
