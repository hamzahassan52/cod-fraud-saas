import { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/connection';
import { cacheGetOrSet, cacheDel } from '../services/cache/redis';

/**
 * Plan Enforcement Middleware
 *
 * - Enforces monthly order usage limits per plan
 * - Returns HTTP 402 Payment Required when exceeded
 * - Auto-resets counter on billing cycle start
 * - All 3 scoring layers enabled for all plans (including free)
 */

interface TenantPlan {
  plan: string;
  orderLimit: number;
  ordersUsed: number;
  billingCycleStart: Date;
}

export async function enforcePlanLimits(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenantId = (request as any).tenantId;
  if (!tenantId) return;

  const tenant = await cacheGetOrSet<TenantPlan>(
    `plan:${tenantId}`,
    async () => {
      const result = await query(
        `SELECT plan, order_limit, orders_used, billing_cycle_start
         FROM tenants WHERE id = $1`,
        [tenantId]
      );
      if (result.rows.length === 0) return null as any;
      const row = result.rows[0];
      return {
        plan: row.plan,
        orderLimit: row.order_limit,
        ordersUsed: row.orders_used,
        billingCycleStart: new Date(row.billing_cycle_start),
      };
    },
    60
  );

  if (!tenant) return;

  // Store plan on request for per-tenant rate limiting
  (request as any).__tenantPlan = tenant.plan;

  // Check if billing cycle needs reset (monthly)
  const now = new Date();
  const cycleStart = new Date(tenant.billingCycleStart);
  const daysSinceCycle = Math.floor(
    (now.getTime() - cycleStart.getTime()) / 86400000
  );

  if (daysSinceCycle >= 30) {
    // Reset usage counter
    await query(
      `UPDATE tenants SET orders_used = 0, billing_cycle_start = NOW() WHERE id = $1`,
      [tenantId]
    );
    await cacheDel(`plan:${tenantId}`);
    return; // Allow request after reset
  }

  // Check limit
  if (tenant.orderLimit > 0 && tenant.ordersUsed >= tenant.orderLimit) {
    reply.code(402).send({
      error: 'Monthly order limit exceeded',
      plan: tenant.plan,
      limit: tenant.orderLimit,
      used: tenant.ordersUsed,
      resetDate: new Date(
        cycleStart.getTime() + 30 * 86400000
      ).toISOString(),
      upgrade: {
        message: 'Upgrade your plan to process more orders',
        plans: {
          starter: { limit: 1000, price: 'PKR 2,999/mo' },
          growth: { limit: 10000, price: 'PKR 7,999/mo' },
          enterprise: { limit: 100000, price: 'PKR 19,999/mo' },
        },
      },
    });
  }

  // Add usage headers
  reply.header('x-plan', tenant.plan);
  reply.header('x-usage-limit', tenant.orderLimit);
  reply.header('x-usage-remaining', Math.max(0, tenant.orderLimit - tenant.ordersUsed));
}
