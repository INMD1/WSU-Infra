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

async function checkQuota(tenantId: string): Promise<void> {
  const quotaResult = await db.select().from(quotas).where(eq(quotas.tenant_id, tenantId));
  const limit = quotaResult[0]?.max_public_ports ?? 10;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(portForwards)
    .where(eq(portForwards.tenant_id, tenantId));
  const current = Number(countResult[0]?.count || 0);

  if (current >= limit) {
    throw new ValidationError(`Port forwarding quota exceeded (${current}/${limit})`);
  }
}

export const portForwardService = {
  async list(tenantId: string) {
    return db
      .select()
      .from(portForwards)
      .where(eq(portForwards.tenant_id, tenantId));
  },

  async create(params: {
    tenantId: string;
    ownerId?: string;
    vmId?: string;
    internalIp: string;
    internalPort: number;
    externalPort?: number;
    protocol?: string;
    description?: string;
  }) {
    validateInput(params);
    await checkQuota(params.tenantId);

    const externalPort = await allocateExternalPort(params.externalPort);
    const protocol = params.protocol || 'tcp';

    // Create rule in pfSense first
    const result = await pfsenseClient.addPortForward({
      internalIp: params.internalIp,
      internalPort: params.internalPort,
      externalPort,
      protocol,
      description: params.description,
    });

    // Persist to DB — if this fails (e.g. race condition on unique port), roll back pfSense rule
    const id = uuidv4();
    try {
      await db.insert(portForwards).values({
        id,
        vm_id: params.vmId || null,
        owner_id: params.ownerId || null,
        tenant_id: params.tenantId,
        protocol,
        internal_ip: params.internalIp,
        internal_port: params.internalPort,
        external_ip: result.externalIp,
        external_port: externalPort,
        pfsense_tracker: result.tracker,
        description: params.description || null,
      });
    } catch (dbError: any) {
      // Rollback pfSense rule to avoid dangling NAT entries
      try {
        await pfsenseClient.deletePortForward(result.tracker);
      } catch (rollbackErr) {
        console.error('[PortForward] pfSense rollback failed after DB error:', rollbackErr);
      }
      // Duplicate port from concurrent request
      if (dbError.code === 'ER_DUP_ENTRY') {
        throw new ValidationError(`External port ${externalPort} was taken by a concurrent request. Retry.`);
      }
      throw dbError;
    }

    return {
      id,
      internal_ip: params.internalIp,
      internal_port: params.internalPort,
      external_ip: result.externalIp,
      external_port: externalPort,
      protocol,
      description: params.description,
    };
  },

  async delete(id: string, tenantId: string) {
    const rows = await db
      .select()
      .from(portForwards)
      .where(and(eq(portForwards.id, id), eq(portForwards.tenant_id, tenantId)));

    if (rows.length === 0) return false;

    const rule = rows[0];
    if (rule.pfsense_tracker) {
      await pfsenseClient.deletePortForward(rule.pfsense_tracker);
    }

    await db.delete(portForwards).where(eq(portForwards.id, id));
    return true;
  },

  async countByTenant(tenantId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(portForwards)
      .where(eq(portForwards.tenant_id, tenantId));
    return Number(result[0]?.count || 0);
  },
};
