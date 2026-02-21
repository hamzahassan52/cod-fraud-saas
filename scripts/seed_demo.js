#!/usr/bin/env node
'use strict';

/**
 * COD Fraud Shield — Demo Data Seeder
 * Seeds demo@cod.com with 1800 realistic Pakistani Shopify orders
 *
 * Run: node scripts/seed_demo.js
 */

const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const DB_URL = 'postgresql://postgres:LffCkMqCOGGAIeQJQlHyMYKHuDJvwjbb@shinkansen.proxy.rlwy.net:23453/railway';
const DEMO_TENANT_ID = 'b90f2e04-4e9a-487b-85cc-2dc0823a8c07';
const SHOPIFY_STORE   = 'trendypk.myshopify.com';
const MODEL_VERSION   = 'v20260221_100112';
const TOTAL_ORDERS    = 1800;

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

// ─── Reference Data ────────────────────────────────────────────────────────────

const MALE_NAMES = [
  'Ahmed Ali','Muhammad Hassan','Ali Raza','Omar Sheikh','Zain Khan','Bilal Ahmed',
  'Hamza Malik','Usman Tariq','Faisal Mirza','Arslan Butt','Kashif Iqbal','Naveed Ahmad',
  'Imran Hussain','Shahid Mehmood','Rizwan Khan','Waqas Ali','Adnan Siddiqui',
  'Salman Chaudhry','Kamran Javed','Fahad Qureshi','Asad Hussain','Talha Baig',
  'Sohail Akhtar','Danyal Rauf','Aamir Shahzad','Farhan Malik','Junaid Ahmed',
  'Raza Abbas','Haris Anwar','Ahmer Siddique','Zubair Sheikh','Hassan Raza',
  'Qasim Tariq','Daniyal Khan','Saif Ali','Noman Baig','Moaz Rehman','Yusuf Anwar',
];

const FEMALE_NAMES = [
  'Ayesha Khan','Fatima Ahmed','Sana Malik','Hina Shah','Maria Ali','Nadia Hassan',
  'Zara Butt','Asma Iqbal','Rabia Tariq','Sobia Ahmad','Amna Sheikh','Mahrukh Raza',
  'Maryam Hussain','Sara Mirza','Noor Fatima','Iqra Javed','Bushra Siddiqui',
  'Huma Chaudhry','Mehwish Qureshi','Saira Naveed','Aiza Rehman','Komal Shabbir',
  'Sidra Batool','Zainab Kazmi','Mariam Saleem','Tooba Rashid','Hafsa Gulzar',
  'Rida Farooq','Alina Tariq','Nimra Ahmed','Laiba Syed','Minahil Zahid','Maha Tauqeer',
];

const ALL_NAMES = [...MALE_NAMES, ...FEMALE_NAMES];

const CITIES = [
  { name: 'Karachi',       rtoRate: 0.32, w: 30 },
  { name: 'Lahore',        rtoRate: 0.28, w: 25 },
  { name: 'Islamabad',     rtoRate: 0.22, w: 10 },
  { name: 'Rawalpindi',    rtoRate: 0.26, w:  8 },
  { name: 'Faisalabad',    rtoRate: 0.30, w:  7 },
  { name: 'Multan',        rtoRate: 0.35, w:  5 },
  { name: 'Peshawar',      rtoRate: 0.38, w:  4 },
  { name: 'Quetta',        rtoRate: 0.40, w:  3 },
  { name: 'Sialkot',       rtoRate: 0.27, w:  3 },
  { name: 'Gujranwala',    rtoRate: 0.31, w:  2 },
  { name: 'Hyderabad',     rtoRate: 0.36, w:  1.5 },
  { name: 'Abbottabad',    rtoRate: 0.29, w:  1 },
  { name: 'Bahawalpur',    rtoRate: 0.33, w:  0.5 },
];

const PRODUCTS = [
  { cat: 'clothing',     items: ['Embroidered Lawn Suit','Chiffon Dupatta Set','Printed Kameez','Party Wear Dress','Cotton Shalwar Kameez'], min: 900,  max: 7500 },
  { cat: 'electronics',  items: ['TWS Wireless Earbuds','Smart Watch Pro','Bluetooth Speaker','Power Bank 20000mAh','Portable LED Fan'],      min: 1800, max: 13000 },
  { cat: 'mobile',       items: ['Silicone Phone Case','Tempered Glass 3-Pack','Fast Charger 65W','Phone Ring Stand','Pop Socket'],          min: 350,  max: 2800 },
  { cat: 'beauty',       items: ['Whitening Serum Kit','BB Cream SPF50','Lipstick Set 6pcs','Vitamin C Face Cream','Glow Face Mask Pack'],   min: 700,  max: 4500 },
  { cat: 'shoes',        items: ['Casual Sneakers','Kohlapuri Chappals','Ladies Block Heels','Sports Running Shoes','Oxford Formal Shoes'],   min: 1400, max: 6500 },
  { cat: 'home',         items: ['Velvet Cushion Set 5pcs','Decorative Wall Clock','LED Fairy Lights','Ceramic Vase Set','Photo Frame Set'], min: 600,  max: 3800 },
  { cat: 'kitchen',      items: ['Non-stick Cookware 3pc','Glass Lunch Box Set','Stainless Water Bottle','Vegetable Chopper','Spice Rack'],  min: 500,  max: 6500 },
];

const PHONE_PREFIXES = ['0300','0301','0302','0303','0310','0311','0320','0321','0330','0331','0340','0341','0345'];

const FRAUD_SIGNALS_HIGH = [
  { signal: 'new_account_high_value',    score: 38 },
  { signal: 'velocity_burst',            score: 32 },
  { signal: 'high_rto_city',             score: 28 },
  { signal: 'repeated_rto_history',      score: 35 },
  { signal: 'electronics_cod_new',       score: 30 },
  { signal: 'multi_name_phone',          score: 25 },
  { signal: 'address_incomplete',        score: 22 },
];

const FRAUD_SIGNALS_MED = [
  { signal: 'cod_first_order_high_value', score: 18 },
  { signal: 'suspicious_discount',        score: 14 },
  { signal: 'high_value_cod',             score: 16 },
  { signal: 'new_customer_cod',           score: 12 },
  { signal: 'weekend_night_order',        score: 10 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rand   = (min, max)  => Math.floor(Math.random() * (max - min + 1)) + min;
const randF  = (min, max)  => parseFloat((Math.random() * (max - min) + min).toFixed(2));
const pick   = arr          => arr[Math.floor(Math.random() * arr.length)];

function weightedCity() {
  const total = CITIES.reduce((s, c) => s + c.w, 0);
  let r = Math.random() * total;
  for (const c of CITIES) { r -= c.w; if (r <= 0) return c; }
  return CITIES[0];
}

function genPhone() {
  const prefix = pick(PHONE_PREFIXES);
  const suffix = String(rand(1000000, 9999999));
  return `+92${prefix.slice(1)}${suffix}`;   // +923001234567
}

function normalizePhone(ph) {
  return ph.replace(/\D/g, '').replace(/^0/, '92');
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const hour = rand(8, 23);
  const min  = rand(0, 59);
  d.setHours(hour, min, rand(0, 59));
  return d;
}

function orderDate(dayOffset) {
  return daysAgo(dayOffset);
}

function productForRisk(riskLevel) {
  if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
    // Electronics + mobiles more in high risk
    return Math.random() < 0.45 ? pick(PRODUCTS.filter(p => p.cat === 'electronics' || p.cat === 'mobile')) : pick(PRODUCTS);
  }
  return pick(PRODUCTS);
}

function buildLineItems(product, qty) {
  return [{ name: pick(product.items), quantity: qty, price: randF(product.min, product.max / qty), category: product.cat }];
}

function buildAddress(city) {
  const areas = {
    'Karachi':    ['DHA Phase 5','Gulshan-e-Iqbal','Clifton Block 4','Nazimabad','North Nazimabad','Malir'],
    'Lahore':     ['DHA Phase 6','Johar Town','Model Town','Gulberg III','Township','Wapda Town'],
    'Islamabad':  ['F-7/2','G-9/3','F-11 Markaz','I-8/3','E-11'],
    'Rawalpindi': ['Satellite Town','Bahria Town Phase 4','Chaklala Scheme 3'],
    'Faisalabad': ['Gulberg Colony','Susan Road','Jhang Road','Peoples Colony'],
    'Multan':     ['Gulgasht Colony','Shah Rukn-e-Alam Colony','New Multan'],
    'Peshawar':   ['Hayatabad Phase 2','University Town','Saddar'],
    'Quetta':     ['Jinnah Road','Satellite Town','Quetta Cantt'],
  };
  const area = areas[city] ? pick(areas[city]) : `Block ${rand(1,10)}, Main Road`;
  return {
    address1: `House ${rand(1,999)}, Street ${rand(1,50)}, ${area}`,
    city,
    province: 'Pakistan',
    zip: String(rand(10000, 99999)),
    country: 'PK',
  };
}

// ─── Fraudster Phones (10 repeat offenders — will be blacklisted) ─────────────

const FRAUD_PHONES = Array.from({ length: 10 }, () => genPhone());
const FRAUD_NAMES  = [
  'Fake Ahmed','Ghost User','Test Customer','Invalid Name','Scam Ali',
  'Fraud Khan','Returns Master','Block Please','Cancel Order','No Deliver',
];

// ─── Order Generator ──────────────────────────────────────────────────────────

function generateOrders() {
  const orders = [];
  let extId = 100001;

  // Daily volume: old→new ramp-up
  const dayBuckets = [];
  for (let d = 89; d >= 0; d--) {
    let count;
    if (d >= 70)      count = rand(4, 8);    // 90-70 days ago: startup
    else if (d >= 45) count = rand(10, 16);  // 70-45: growing
    else if (d >= 20) count = rand(18, 26);  // 45-20: established
    else              count = rand(22, 32);  // 20-0: active
    dayBuckets.push({ day: d, count });
  }

  // Add ~50 fraud orders spread across all days
  const fraudDays = Array.from({ length: 50 }, () => rand(0, 89));

  for (const { day, count } of dayBuckets) {
    const fraudCount = fraudDays.filter(d => d === day).length;

    for (let i = 0; i < count; i++) {
      const city    = weightedCity();
      const product = productForRisk('LOW');
      const qty     = rand(1, 3);
      const items   = buildLineItems(product, qty);
      const amount  = parseFloat((items.reduce((s, it) => s + it.price * it.quantity, 0)).toFixed(2));
      const name    = pick(ALL_NAMES);
      const phone   = genPhone();
      const createdAt = orderDate(day);

      // Determine recommendation based on risk factors
      let rec, riskScore, riskLevel, signals;
      const r = Math.random();
      if (r < 0.62) {
        rec = 'APPROVE'; riskScore = rand(8, 44);
        riskLevel = riskScore < 30 ? 'LOW' : 'MEDIUM';
        signals = [];
      } else if (r < 0.86) {
        rec = 'VERIFY'; riskScore = rand(45, 74);
        riskLevel = 'MEDIUM';
        signals = [pick(FRAUD_SIGNALS_MED), ...(Math.random() < 0.4 ? [pick(FRAUD_SIGNALS_MED)] : [])];
      } else {
        rec = 'BLOCK'; riskScore = rand(75, 97);
        riskLevel = riskScore >= 85 ? 'CRITICAL' : 'HIGH';
        signals = [pick(FRAUD_SIGNALS_HIGH), pick(FRAUD_SIGNALS_HIGH), ...(Math.random() < 0.5 ? [pick(FRAUD_SIGNALS_MED)] : [])];
      }

      // Status based on age + recommendation
      let status;
      if (rec === 'BLOCK') {
        status = 'blocked';
      } else if (day > 10) {
        if (rec === 'APPROVE') status = Math.random() < 0.80 ? 'delivered' : 'rto';
        else                   status = Math.random() < 0.67 ? 'delivered' : 'rto';
      } else if (day > 3) {
        status = rec === 'APPROVE' ? 'approved' : 'verified';
      } else {
        status = 'pending';
      }

      const ruleScore  = randF(riskScore * 0.7, riskScore * 1.1);
      const statScore  = randF(riskScore * 0.7, riskScore * 1.1);
      const mlScore    = randF(riskScore * 0.8, riskScore * 1.05);
      const address    = buildAddress(city.name);

      orders.push({
        id:              randomUUID(),
        extId:           `SHF${extId++}`,
        name,
        phone,
        phone_n:         normalizePhone(phone),
        email:           `${name.split(' ')[0].toLowerCase()}${rand(10,99)}@gmail.com`,
        city:            city.name,
        address,
        amount,
        items,
        payment:         Math.random() < 0.72 ? 'COD' : 'prepaid',
        rec,
        riskScore,
        riskLevel,
        signals:         [...new Map(signals.map(s => [s.signal, s])).values()],
        status,
        ruleScore:       Math.min(100, ruleScore),
        statScore:       Math.min(100, statScore),
        mlScore:         Math.min(100, mlScore),
        createdAt,
        isFraud:         false,
      });
    }

    // Add fraud orders for this day
    for (let f = 0; f < fraudCount; f++) {
      const fraudPhone = pick(FRAUD_PHONES);
      const fraudName  = pick(FRAUD_NAMES);
      const product    = pick(PRODUCTS.filter(p => p.cat === 'electronics' || p.cat === 'mobile'));
      const qty        = rand(1, 2);
      const items      = buildLineItems(product, qty);
      const amount     = parseFloat((items.reduce((s, it) => s + it.price * it.quantity, 0)).toFixed(2));
      const riskScore  = rand(82, 99);
      const city       = pick(CITIES.filter(c => c.rtoRate >= 0.35));
      const createdAt  = orderDate(day);

      orders.push({
        id:          randomUUID(),
        extId:       `SHF${extId++}`,
        name:        fraudName,
        phone:       fraudPhone,
        phone_n:     normalizePhone(fraudPhone),
        email:       `fraud${rand(100,999)}@tempmail.com`,
        city:        city.name,
        address:     buildAddress(city.name),
        amount,
        items,
        payment:     'COD',
        rec:         'BLOCK',
        riskScore,
        riskLevel:   'CRITICAL',
        signals:     [FRAUD_SIGNALS_HIGH[0], FRAUD_SIGNALS_HIGH[1], FRAUD_SIGNALS_HIGH[2]],
        status:      'blocked',
        ruleScore:   rand(80, 95),
        statScore:   rand(75, 92),
        mlScore:     rand(82, 98),
        createdAt,
        isFraud:     true,
      });
    }
  }

  return orders;
}

// ─── Blacklist Entries ────────────────────────────────────────────────────────

function buildBlacklist() {
  const entries = [];

  FRAUD_PHONES.forEach((phone, i) => {
    entries.push({
      type:   'phone',
      value:  phone,
      value_n: normalizePhone(phone),
      reason: `Repeat fraud — ${rand(3,6)} blocked orders, ${rand(0,1) === 0 ? 'refused delivery' : 'fake address provided'}, flagged by system`,
    });
  });

  const fraudEmails = [
    'fraud.orders99@tempmail.com','test.cod.fake@yopmail.com','returns.master@mailinator.com',
    'nodelivery123@guerrillamail.com','scammer.pk@tempinbox.com',
  ];
  fraudEmails.forEach(email => {
    entries.push({ type: 'email', value: email, value_n: email.toLowerCase(), reason: 'Fake email — multiple chargebacks and refused deliveries' });
  });

  const fraudIPs = ['182.180.42.11','39.35.196.88','103.255.4.72'];
  fraudIPs.forEach(ip => {
    entries.push({ type: 'ip', value: ip, value_n: ip, reason: `${rand(5,12)} orders placed from this IP in 24 hours — velocity fraud` });
  });

  const fraudAddresses = ['Shop 4, Shershah Godam, Karachi', 'Godown B-7, Main Bund Road, Lahore'];
  fraudAddresses.forEach(addr => {
    entries.push({ type: 'address', value: addr, value_n: addr.toLowerCase(), reason: 'Fake warehouse address — no actual delivery possible, multiple returns logged' });
  });

  return entries;
}

// ─── Performance Snapshots (12 weeks) ────────────────────────────────────────

function buildSnapshots() {
  const snaps = [];
  for (let w = 12; w >= 1; w--) {
    const startDate = new Date(); startDate.setDate(startDate.getDate() - w * 7);
    const endDate   = new Date(startDate); endDate.setDate(endDate.getDate() + 6);
    const total     = rand(80, 160);
    const blocked   = Math.floor(total * randF(0.12, 0.16));
    const approved  = Math.floor(total * randF(0.58, 0.65));
    const verified  = total - blocked - approved;
    const blockedRto     = Math.floor(blocked * randF(0.72, 0.88));
    const approvedRto    = Math.floor(approved * randF(0.04, 0.12));
    const precision      = parseFloat((blockedRto / blocked).toFixed(4));
    const recall         = parseFloat((blockedRto / (blockedRto + approvedRto + 1)).toFixed(4));
    const f1             = parseFloat((2 * precision * recall / (precision + recall + 0.0001)).toFixed(4));
    snaps.push({
      period_start:       startDate.toISOString().slice(0, 10),
      period_end:         endDate.toISOString().slice(0, 10),
      total_orders:       total,
      total_blocked:      blocked,
      total_approved:     approved,
      total_verified:     verified,
      blocked_rto:        blockedRto,
      blocked_delivered:  blocked - blockedRto,
      approved_rto:       approvedRto,
      approved_delivered: approved - approvedRto,
      precision_at_block: precision,
      recall,
      f1_score:           f1,
      avg_risk_score:     randF(38, 54),
      model_version:      MODEL_VERSION,
    });
  }
  return snaps;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  console.log('\n🚀 COD Fraud Shield — Demo Data Seeder\n');

  try {
    await client.query('BEGIN');

    // ── 1. Clear demo tenant data ──────────────────────────────────────────
    console.log('🗑️  Clearing existing demo data...');
    const existingPhones = await client.query(
      `SELECT DISTINCT phone_normalized FROM orders WHERE tenant_id = $1 AND phone_normalized IS NOT NULL`,
      [DEMO_TENANT_ID]
    );
    await client.query(`DELETE FROM performance_snapshots WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    await client.query(`DELETE FROM prediction_logs       WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    await client.query(`DELETE FROM risk_logs             WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    await client.query(`DELETE FROM rto_reports           WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    await client.query(`DELETE FROM fraud_scores          WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    await client.query(`DELETE FROM blacklist             WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    await client.query(`DELETE FROM addresses             WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    await client.query(`DELETE FROM orders                WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    await client.query(`DELETE FROM shopify_connections   WHERE tenant_id = $1`, [DEMO_TENANT_ID]);

    // Clean up orphaned phone records
    if (existingPhones.rows.length > 0) {
      const phones = existingPhones.rows.map(r => r.phone_normalized);
      await client.query(`DELETE FROM phones WHERE phone_normalized = ANY($1)`, [phones]);
    }
    console.log('   ✅ Cleared.\n');

    // ── 2. Shopify connection ──────────────────────────────────────────────
    console.log('🛍️  Inserting Shopify connection...');
    await client.query(
      `INSERT INTO shopify_connections (id, tenant_id, shop, access_token, scopes, webhook_id, installed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(), DEMO_TENANT_ID, SHOPIFY_STORE,
        'shpat_demo_access_token_trendypk_3a7b2c9d4e',
        'read_orders,write_orders,read_customers',
        'wh_demo_9847362',
        new Date(Date.now() - 92 * 24 * 60 * 60 * 1000),
      ]
    );
    console.log(`   ✅ Connected: ${SHOPIFY_STORE}\n`);

    // ── 3. Generate + insert orders ────────────────────────────────────────
    console.log(`📦  Generating ${TOTAL_ORDERS} orders...`);
    const orders = generateOrders();
    console.log(`   Generated ${orders.length} orders. Inserting...`);

    let inserted = 0;
    const phoneMap = new Map(); // phone_normalized → {total_orders, total_rto, total_amount}

    for (let i = 0; i < orders.length; i += 50) {
      const batch = orders.slice(i, i + 50);

      for (const o of batch) {
        const riskSummary = o.rec === 'APPROVE'
          ? `Low risk order. Customer from ${o.city} with clean history.`
          : o.rec === 'VERIFY'
          ? `Order requires review: ${o.signals[0] ? o.signals[0].signal.replace(/_/g,' ') : 'risk factor detected'} — manual verification recommended.`
          : `HIGH FRAUD RISK: ${o.signals.map(s => s.signal.replace(/_/g,' ')).join(', ')}. Order blocked automatically.`;

        await client.query(
          `INSERT INTO orders (
            id, tenant_id, external_order_id, platform, platform_data,
            customer_name, customer_email, customer_phone, phone_normalized,
            shipping_address, shipping_city, shipping_country,
            payment_method, currency, total_amount, items_count, line_items,
            risk_score, risk_level, recommendation, fraud_signals, risk_summary,
            status, is_repeat_customer, previous_order_count, previous_rto_count,
            scored_at, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
            $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$28
          )`,
          [
            o.id, DEMO_TENANT_ID, o.extId, 'shopify',
            JSON.stringify({ source: 'shopify_webhook', store: SHOPIFY_STORE }),
            o.name, o.email, o.phone, o.phone_n,
            JSON.stringify(o.address), o.city, 'PK',
            o.payment, 'PKR', o.amount, o.items.length,
            JSON.stringify(o.items),
            o.riskScore, o.riskLevel, o.rec,
            JSON.stringify(o.signals), riskSummary,
            o.status,
            o.isFraud,
            o.isFraud ? rand(3, 7) : (Math.random() < 0.15 ? rand(1,3) : 0),
            o.isFraud ? rand(2, 5) : (Math.random() < 0.08 ? rand(1,2) : 0),
            o.createdAt, o.createdAt,
          ]
        );

        // fraud_scores row
        await client.query(
          `INSERT INTO fraud_scores (
            id, order_id, tenant_id,
            rule_score, statistical_score, ml_score,
            final_score, confidence,
            signals, ml_model_version, scored_at, scoring_duration_ms
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            randomUUID(), o.id, DEMO_TENANT_ID,
            o.ruleScore, o.statScore, o.mlScore,
            o.riskScore,
            parseFloat((Math.abs(o.riskScore / 100 - 0.5) * 2).toFixed(4)),
            JSON.stringify(o.signals), MODEL_VERSION,
            o.createdAt, rand(85, 420),
          ]
        );

        // Track phone stats
        if (!phoneMap.has(o.phone_n)) {
          phoneMap.set(o.phone_n, { total: 0, rto: 0, amount: 0, last: o.createdAt, first: o.createdAt });
        }
        const ps = phoneMap.get(o.phone_n);
        ps.total++;
        if (o.status === 'rto') ps.rto++;
        ps.amount += o.amount;
        if (o.createdAt > ps.last) ps.last = o.createdAt;
        if (o.createdAt < ps.first) ps.first = o.createdAt;

        inserted++;
      }

      process.stdout.write(`\r   Inserted ${inserted}/${orders.length} orders...`);
    }
    console.log(`\n   ✅ ${inserted} orders inserted.\n`);

    // ── 4. Phone intelligence ──────────────────────────────────────────────
    console.log(`📱  Building phone intelligence (${phoneMap.size} unique phones)...`);
    for (const [phone_n, ps] of phoneMap) {
      const rtoRate = ps.total > 0 ? parseFloat((ps.rto / ps.total).toFixed(4)) : 0;
      const isFraud = FRAUD_PHONES.map(normalizePhone).includes(phone_n);
      const riskTier = isFraud || rtoRate >= 0.6 ? 'high' : rtoRate >= 0.3 ? 'medium' : 'low';
      try {
        await client.query(
          `INSERT INTO phones (
            id, phone_normalized, raw_formats, carrier, phone_type, region,
            total_orders, total_rto, rto_rate, total_amount_ordered,
            first_seen_at, last_seen_at, is_blacklisted, risk_tier
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (phone_normalized) DO UPDATE SET
            total_orders = EXCLUDED.total_orders,
            total_rto = EXCLUDED.total_rto,
            rto_rate = EXCLUDED.rto_rate,
            total_amount_ordered = EXCLUDED.total_amount_ordered,
            last_seen_at = EXCLUDED.last_seen_at,
            is_blacklisted = EXCLUDED.is_blacklisted,
            risk_tier = EXCLUDED.risk_tier`,
          [
            randomUUID(), phone_n, [`0${phone_n.slice(2)}`],
            pick(['jazz','telenor','ufone','zong']), 'mobile', 'Pakistan',
            ps.total, ps.rto, rtoRate,
            parseFloat(ps.amount.toFixed(2)),
            ps.first, ps.last, isFraud, riskTier,
          ]
        );
      } catch (_) {}
    }
    console.log('   ✅ Phone intelligence done.\n');

    // ── 5. Blacklist ───────────────────────────────────────────────────────
    console.log('🚫  Adding blacklist entries...');
    const blacklist = buildBlacklist();
    for (const bl of blacklist) {
      try {
        await client.query(
          `INSERT INTO blacklist (id, tenant_id, type, value, value_normalized, reason)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, type, value_normalized) DO NOTHING`,
          [randomUUID(), DEMO_TENANT_ID, bl.type, bl.value, bl.value_n, bl.reason]
        );
      } catch (_) {}
    }
    console.log(`   ✅ ${blacklist.length} blacklist entries added.\n`);

    // ── 6. Performance snapshots ───────────────────────────────────────────
    console.log('📊  Inserting weekly performance snapshots...');
    const snaps = buildSnapshots();
    for (const s of snaps) {
      try {
        await client.query(
          `INSERT INTO performance_snapshots (
            id, tenant_id, period_start, period_end, period_type,
            total_orders, total_blocked, total_approved, total_verified,
            blocked_rto, blocked_delivered, approved_rto, approved_delivered,
            precision_at_block, recall, f1_score, avg_risk_score, model_version
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (tenant_id, period_start, period_type) DO NOTHING`,
          [
            randomUUID(), DEMO_TENANT_ID, s.period_start, s.period_end, 'weekly',
            s.total_orders, s.total_blocked, s.total_approved, s.total_verified,
            s.blocked_rto, s.blocked_delivered, s.approved_rto, s.approved_delivered,
            s.precision_at_block, s.recall, s.f1_score, s.avg_risk_score, s.model_version,
          ]
        );
      } catch (_) {}
    }
    console.log(`   ✅ ${snaps.length} weekly snapshots inserted.\n`);

    // ── 7. Update tenant orders_used ──────────────────────────────────────
    await client.query(
      `UPDATE tenants SET orders_used = $1 WHERE id = $2`,
      [inserted, DEMO_TENANT_ID]
    );

    await client.query('COMMIT');

    // ── Summary ───────────────────────────────────────────────────────────
    const approveCount = orders.filter(o => o.rec === 'APPROVE').length;
    const verifyCount  = orders.filter(o => o.rec === 'VERIFY').length;
    const blockCount   = orders.filter(o => o.rec === 'BLOCK').length;
    const rtoCount     = orders.filter(o => o.status === 'rto').length;
    const delivCount   = orders.filter(o => o.status === 'delivered').length;
    const revProtected = orders.filter(o => o.rec === 'BLOCK').reduce((s, o) => s + o.amount, 0);

    console.log('═══════════════════════════════════════════════════════');
    console.log('  ✅  DEMO DATA SEEDED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Total Orders  : ${inserted}`);
    console.log(`  ✅ APPROVE    : ${approveCount} (${Math.round(approveCount/inserted*100)}%)`);
    console.log(`  ⚠️  VERIFY    : ${verifyCount}  (${Math.round(verifyCount/inserted*100)}%)`);
    console.log(`  🚫 BLOCK      : ${blockCount}  (${Math.round(blockCount/inserted*100)}%)`);
    console.log(`  📦 Delivered  : ${delivCount}`);
    console.log(`  📦 RTO        : ${rtoCount}  (RTO rate: ${Math.round(rtoCount/(rtoCount+delivCount)*100)}%)`);
    console.log(`  💰 Revenue Protected: PKR ${Math.round(revProtected).toLocaleString()}`);
    console.log(`  📱 Unique Phones: ${phoneMap.size}`);
    console.log(`  🚫 Blacklisted: ${blacklist.length} entries`);
    console.log(`  🛍️  Platform: Shopify (${SHOPIFY_STORE})`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Login: demo@cod.com / cod4400F');
    console.log('  URL  : https://cod-fraud-saas.vercel.app');
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
