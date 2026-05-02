import { mysqlTable, varchar, int, timestamp, text, json, decimal } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  username: varchar('username', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(), // 실제로는 해싱된 비밀번호 저장
  role: varchar('role', { length: 50 }).default('user').notNull(),
  created_at: timestamp('created_at').defaultNow(),
});

export const vms = mysqlTable('vms', {
  vm_id: varchar('vm_id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('creating'),
  vcpu: int('vcpu').notNull(),
  ram_gb: int('ram_gb').notNull(),
  disk_gb: int('disk_gb').notNull(),
  image_id: varchar('image_id', { length: 255 }).notNull(),
  ssh_host: varchar('ssh_host', { length: 255 }),
  ssh_port: int('ssh_port'),
  internal_ip: varchar('internal_ip', { length: 50 }),
  esxi_moref: varchar('esxi_moref', { length: 255 }),
  ssh_public_key: text('ssh_public_key'),
  job_id: varchar('job_id', { length: 100 }),
  owner_id: varchar('owner_id', { length: 36 }).references(() => users.id),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').onUpdateNow(),
});

export const quotas = mysqlTable('quotas', {
  tenant_id: varchar('tenant_id', { length: 36 }).primaryKey(),
  max_vm_count: int('max_vm_count').default(5).notNull(),
  max_vcpu_total: int('max_vcpu_total').default(20).notNull(),
  max_ram_gb_total: int('max_ram_gb_total').default(64).notNull(),
  max_disk_gb_total: int('max_disk_gb_total').default(1000).notNull(),
  max_public_ports: int('max_public_ports').default(10).notNull(),
  max_snapshots_per_vm: int('max_snapshots_per_vm').default(3).notNull(),
  updated_at: timestamp('updated_at').onUpdateNow(),
});
