#!/usr/bin/env node
'use strict';
/**
 * COD Fraud Shield — Category Demo Seeder
 * Creates 34 separate demo accounts (one per category) with 100 orders each.
 * Uses BATCH INSERT for speed — finishes in ~2-3 minutes.
 *
 * Run: NODE_PATH=./backend/node_modules node scripts/seed_category_demos.js
 */

const { Pool }               = require('pg');
const { randomUUID, createHash } = require('crypto');

const DB_URL       = 'postgresql://postgres:LffCkMqCOGGAIeQJQlHyMYKHuDJvwjbb@shinkansen.proxy.rlwy.net:23453/railway';
const PASSWORD     = 'Demo4400F';
const MODEL_VER    = 'v20260221_100112';
const ORDERS_EACH  = 100;

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

// ─── Category Definitions ─────────────────────────────────────────────────────
const CATEGORIES = [
  { name:'Beauty & Health',            email:'beautyhealth@cod.com',    slug:'beauty-health-demo',       store:'beautyhealthpk.myshopify.com',     min:600,   max:4000,  products:['Whitening Serum Kit','Face Glow Cream','Lipstick Set 6pcs','Perfume Gift Set','Vitamin C Tablets','Charcoal Face Mask','Hair Growth Oil'] },
  { name:'Women\'s Clothing',          email:'womensclothing@cod.com',  slug:'womens-clothing-demo',     store:'womensfashionpk.myshopify.com',    min:1500,  max:8000,  products:['Embroidered Lawn Suit 3pc','Chiffon Party Dress','Fancy Kurti Set','Designer Abaya','Bridal Lehenga Mini','Cotton Casual Kurta'] },
  { name:'Home & Kitchen',             email:'homekitchen@cod.com',     slug:'home-kitchen-demo',        store:'homekitchenpk.myshopify.com',      min:800,   max:8000,  products:['Non-stick Cookware Set','Bedding Sheet Set','Curtain Pair','Kitchen Organizer','Storage Box Set','Cushion Cover Set 5pcs'] },
  { name:'Men\'s Clothing',            email:'mensclothing@cod.com',    slug:'mens-clothing-demo',       store:'mensfashionpk.myshopify.com',      min:1500,  max:6000,  products:['Formal Dress Shirt','Shalwar Kameez Set','Polo T-Shirt Pack 2','Winter Jacket','Casual Trouser','Waistcoat Set'] },
  { name:'Women\'s Shoes',             email:'womensshoes@cod.com',     slug:'womens-shoes-demo',        store:'womenshoespk.myshopify.com',       min:1200,  max:5500,  products:['Block Heel Sandals','Casual Flat Pumps','Wedge Slippers','Ladies Sneakers','Khussa Embroidered','Ballet Flats'] },
  { name:'Men\'s Underwear & Sleepwear',email:'mensunderwear@cod.com',  slug:'mens-underwear-demo',      store:'mensthermalspk.myshopify.com',     min:500,   max:2500,  products:['Boxer Brief Pack 3','Pajama Set Cotton','Thermal Inner Suit','Vest Pack 5','Loungewear Tracksuit','Night Suit Set'] },
  { name:'Sports & Outdoors',          email:'sports@cod.com',          slug:'sports-outdoors-demo',     store:'sportspk.myshopify.com',           min:800,   max:9000,  products:['Cricket Bat Tape Ball','Gym Dumbbells Pair','Yoga Mat Premium','Running Shoes','Resistance Bands Set','Football Official Size'] },
  { name:'Office & School Supplies',   email:'officesupplies@cod.com',  slug:'office-supplies-demo',     store:'officepk.myshopify.com',           min:300,   max:2500,  products:['Stationery Combo Set','A4 Notebook Pack 5','Pen Marker Set','File Folder Organizer','Desk Organizer','Scientific Calculator'] },
  { name:'Toys & Games',               email:'toysgames@cod.com',       slug:'toys-games-demo',          store:'toyspk.myshopify.com',             min:600,   max:5000,  products:['RC Remote Control Car','Lego Building Blocks','Doll House Set','Action Figure Pack','Board Game Family','Slime Kit DIY'] },
  { name:'Kids\' Fashion',             email:'kidsfashion@cod.com',     slug:'kids-fashion-demo',        store:'kidsfashionpk.myshopify.com',      min:500,   max:3500,  products:['School Uniform Set','Kids Kurta Pajama','Baby Romper 3pc','Girls Party Dress','Boys Casual Set','Kids Winter Jacket'] },
  { name:'Electronics',                email:'electronics@cod.com',     slug:'electronics-demo',         store:'electronicspk.myshopify.com',      min:2000,  max:18000, products:['TWS Wireless Earbuds','Smart Watch Android','Bluetooth Speaker','Power Bank 20000mAh','Neck Fan Portable','LED Ring Light'] },
  { name:'Business, Industry & Science',email:'business@cod.com',       slug:'business-demo',            store:'businesspk.myshopify.com',         min:2000,  max:20000, products:['Office Chair Ergonomic','Thermal Label Printer','Weighing Scale Digital','Safety Gloves Pack','ID Card Printer','CCTV Camera Set'] },
  { name:'Pet Supplies',               email:'petsupplies@cod.com',     slug:'pet-supplies-demo',        store:'petspk.myshopify.com',             min:600,   max:4000,  products:['Dog Food Premium 5kg','Cat Litter Sand 5L','Pet Collar Leash Set','Bird Cage Medium','Fish Tank 20L','Dog Grooming Kit'] },
  { name:'Jewellery & Accessories',    email:'jewellery@cod.com',       slug:'jewellery-demo',           store:'jewellrypk.myshopify.com',         min:800,   max:9000,  products:['Gold Plated Necklace Set','Studded Earrings Pack','Ladies Watch Classic','Bangles Set 12pcs','Hair Accessories Kit','Sunglasses Polarized'] },
  { name:'Automotive',                 email:'automotive@cod.com',      slug:'automotive-demo',          store:'carpk.myshopify.com',              min:800,   max:10000, products:['Car Seat Cover Set','Dashboard Camera Full HD','Car Freshener Set','Tyre Inflator Electric','Wiper Blades Pair','Car Polish Kit'] },
  { name:'Women\'s Curve Clothing',    email:'womenscurve@cod.com',     slug:'womens-curve-demo',        store:'curvefashionpk.myshopify.com',     min:1500,  max:6000,  products:['Plus Size Abaya','Curve Kurta Set XL','Maxi Dress Plus','Plus Formal Suit','Casual Palazzo Set','Kaftan Dress'] },
  { name:'Musical Instruments',        email:'musical@cod.com',         slug:'musical-demo',             store:'musicpk.myshopify.com',            min:1500,  max:20000, products:['Classical Guitar 40"','Tabla Set Beginner','Electronic Keyboard 61 Key','Harmonium Portable','Flute Bamboo','Drum Pad Practice'] },
  { name:'Bags & Luggage',             email:'bags@cod.com',            slug:'bags-luggage-demo',        store:'bagspk.myshopify.com',             min:900,   max:9000,  products:['Ladies Handbag Leather','Travel Trolley Bag 24"','School Backpack','Laptop Bag 15"','Wallet Slim Leather','Crossbody Sling Bag'] },
  { name:'Health & Household',         email:'health@cod.com',          slug:'health-household-demo',    store:'healthpk.myshopify.com',           min:800,   max:6000,  products:['BP Monitor Digital','Glucometer Kit','Pulse Oximeter','Thermometer Infrared','Nebulizer Machine','Knee Support Brace'] },
  { name:'Patio, Lawn & Garden',       email:'garden@cod.com',          slug:'patio-garden-demo',        store:'gardenpk.myshopify.com',           min:600,   max:5000,  products:['Garden Tools Set 10pc','Flower Pots Ceramic Set','Solar Garden Lights','Water Sprinkler Rotating','Plant Seeds Pack','Garden Hose 20m'] },
  { name:'Tools & Home Improvement',   email:'tools@cod.com',           slug:'tools-demo',               store:'toolspk.myshopify.com',            min:700,   max:9000,  products:['Cordless Drill 18V','Screwdriver Set 32pc','Paint Brush Set','Measuring Tape 5m','Wall Putty Knife Set','Extension Board 6-way'] },
  { name:'Appliances',                 email:'appliances@cod.com',      slug:'appliances-demo',          store:'appliancespk.myshopify.com',       min:3000,  max:28000, products:['Air Fryer 5L Digital','Rice Cooker 1.8L','Hand Blender Set','Dry Iron Philips','Electric Kettle 1.5L','Food Processor 800W'] },
  { name:'Women\'s Lingerie & Lounge', email:'lingerie@cod.com',        slug:'womens-lingerie-demo',     store:'lingerypk.myshopify.com',          min:500,   max:3500,  products:['Bra Set 2pc','Silk Loungewear Set','Lace Nightgown','Camisole 3-Pack','Thermal Undergarment Set','Satin Pyjama Set'] },
  { name:'Baby & Maternity',           email:'baby@cod.com',            slug:'baby-maternity-demo',      store:'babypk.myshopify.com',             min:600,   max:5000,  products:['Baby Clothes Gift Set 7pc','Disposable Diapers L-40','Baby Soft Toys Set','Maternity Dress Casual','Baby Feeding Bottle Set','Stroller Lightweight'] },
  { name:'Men\'s Big & Tall',          email:'mensbig@cod.com',         slug:'mens-big-tall-demo',       store:'mensbigtallpk.myshopify.com',      min:1500,  max:6000,  products:['Plus Size Kurta Shalwar XL','Oversized T-Shirt 3XL','Large Formal Shirt','Big Size Trouser','Winter Sweater XXL','Plus Polo Shirt'] },
  { name:'Smart Home',                 email:'smarthome@cod.com',       slug:'smart-home-demo',          store:'smarthomepk.myshopify.com',        min:1500,  max:20000, products:['Smart WiFi Bulb 4pc','Smart Plug 2-Pack','WiFi Security Camera','Smart Switch 3-Gang','Robot Vacuum Cleaner','Smart Door Lock'] },
  { name:'Arts, Crafts & Sewing',      email:'artscrafts@cod.com',      slug:'arts-crafts-demo',         store:'craftspk.myshopify.com',           min:500,   max:8000,  products:['Mini Sewing Machine','Acrylic Paint Set 24','Canvas Boards 5pc','Knitting Needles Set','Resin Art Kit','Calligraphy Pen Set'] },
  { name:'Men\'s Shoes',               email:'mensshoes@cod.com',       slug:'mens-shoes-demo',          store:'menshoespk.myshopify.com',         min:1500,  max:8000,  products:['Formal Oxford Shoes','Sports Running Shoes','Casual Loafers','Kohlapuri Sandals','Chelsea Boots','Sneakers High-top'] },
  { name:'Kids\' Shoes',               email:'kidsshoes@cod.com',       slug:'kids-shoes-demo',          store:'kidshoespk.myshopify.com',         min:600,   max:3500,  products:['School Shoes Black','Kids Sports Shoes','Sandals Velcro Boys','Girls Ballet Shoes','Baby First Walkers','Kids Boots Winter'] },
  { name:'Mobile Phones & Accessories',email:'mobile@cod.com',          slug:'mobile-demo',              store:'mobilepk.myshopify.com',           min:300,   max:5000,  products:['Silicone Phone Case Pack','Tempered Glass 3-Pack','Fast Charger 65W PD','Wireless Earphones','Ring Light Selfie','PopSocket Grip Set'] },
  { name:'Food & Grocery',             email:'food@cod.com',            slug:'food-grocery-demo',        store:'grocerpk.myshopify.com',           min:500,   max:4000,  products:['Premium Dry Fruits 500g','Himalayan Pink Salt','Organic Honey 1kg','Desi Ghee 1kg','Mixed Spices Set','Green Tea Collection'] },
  { name:'Books & Media',              email:'books@cod.com',           slug:'books-media-demo',         store:'bookspk.myshopify.com',            min:300,   max:3000,  products:['Islamic Books Set 5','Urdu Novel Collection','IELTS Preparation Pack','Children Story Books Set','Quran with Translation','Motivational Books 3'] },
  { name:'Beachwear',                  email:'beachwear@cod.com',       slug:'beachwear-demo',           store:'beachwearpk.myshopify.com',        min:600,   max:4000,  products:['Swimming Shorts Men','Polarized Sunglasses','Beach Towel Oversized','Flip Flops Rubber Pair','Swim Cap Silicone','Beach Bag Tote'] },
  { name:'Furniture',                  email:'furniture@cod.com',       slug:'furniture-demo',           store:'furniturepk.myshopify.com',        min:4000,  max:35000, products:['Study Table Foldable','Bookshelf 5-Tier Wood','Computer Chair Mesh','Bedside Table Drawer','TV Stand Modern','Sofa Chair Single'] },
];

// ─── Reference Data ───────────────────────────────────────────────────────────
const MALE_NAMES = ['Ahmed Ali','Muhammad Hassan','Ali Raza','Omar Sheikh','Zain Khan','Bilal Ahmed','Hamza Malik','Usman Tariq','Faisal Mirza','Arslan Butt','Kashif Iqbal','Naveed Ahmad','Imran Hussain','Rizwan Khan','Waqas Ali','Salman Chaudhry','Kamran Javed','Fahad Qureshi','Asad Hussain','Talha Baig','Sohail Akhtar','Farhan Malik','Junaid Ahmed','Haris Anwar','Daniyal Khan','Saif Ali','Noman Baig','Yusuf Anwar'];
const FEMALE_NAMES = ['Ayesha Khan','Fatima Ahmed','Sana Malik','Hina Shah','Maria Ali','Nadia Hassan','Zara Butt','Asma Iqbal','Rabia Tariq','Sobia Ahmad','Amna Sheikh','Maryam Hussain','Sara Mirza','Noor Fatima','Iqra Javed','Bushra Siddiqui','Huma Chaudhry','Mehwish Qureshi','Saira Naveed','Aiza Rehman','Komal Shabbir','Zainab Kazmi','Tooba Rashid','Hafsa Gulzar','Nimra Ahmed','Laiba Syed','Minahil Zahid'];
const ALL_NAMES = [...MALE_NAMES, ...FEMALE_NAMES];
const CITIES = [
  { name:'Karachi', w:30 },{ name:'Lahore', w:25 },{ name:'Islamabad', w:10 },
  { name:'Rawalpindi', w:8 },{ name:'Faisalabad', w:7 },{ name:'Multan', w:5 },
  { name:'Peshawar', w:4 },{ name:'Quetta', w:3 },{ name:'Sialkot', w:3 },
  { name:'Gujranwala', w:2 },{ name:'Hyderabad', w:2 },{ name:'Bahawalpur', w:1 },
];
const PHONE_PREFIXES = ['0300','0301','0302','0303','0310','0311','0320','0321','0330','0340','0341','0345'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rand  = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const randF = (a,b) => parseFloat((Math.random()*(b-a)+a).toFixed(2));
const pick  = a     => a[Math.floor(Math.random()*a.length)];

function weightedCity() {
  const total = CITIES.reduce((s,c)=>s+c.w,0);
  let r = Math.random()*total;
  for (const c of CITIES){ r-=c.w; if(r<=0) return c.name; }
  return 'Karachi';
}

function genPhone() {
  return `+92${pick(PHONE_PREFIXES).slice(1)}${rand(1000000,9999999)}`;
}

function normPhone(p) { return p.replace(/\D/g,'').replace(/^0/,'92'); }

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate()-n);
  d.setHours(rand(8,23), rand(0,59), rand(0,59));
  return d;
}

// ─── Generate 100 orders for a category ──────────────────────────────────────
function genOrders(cat, tenantId) {
  const orders = [];
  const scores = [];
  for (let i = 0; i < ORDERS_EACH; i++) {
    const id       = randomUUID();
    const phone    = genPhone();
    const phone_n  = normPhone(phone);
    const name     = pick(ALL_NAMES);
    const city     = weightedCity();
    const product  = pick(cat.products);
    const qty      = rand(1,3);
    const amount   = randF(cat.min, cat.max);
    const payment  = Math.random()<0.72 ? 'COD' : 'prepaid';
    const dayOff   = rand(0, 89);
    const createdAt= daysAgo(dayOff);

    // Risk
    const r = Math.random();
    let rec, riskScore, riskLevel, signals;
    if (r < 0.62) {
      rec='APPROVE'; riskScore=rand(8,44); riskLevel=riskScore<30?'LOW':'MEDIUM'; signals=[];
    } else if (r < 0.86) {
      rec='VERIFY'; riskScore=rand(45,74); riskLevel='MEDIUM';
      signals=[{signal:'cod_first_order_high_value',score:18},{signal:'high_rto_area',score:14}].slice(0,rand(1,2));
    } else {
      rec='BLOCK'; riskScore=rand(75,97); riskLevel=riskScore>=85?'CRITICAL':'HIGH';
      signals=[{signal:'new_account_high_value',score:38},{signal:'velocity_burst',score:28},{signal:'high_rto_city',score:22}].slice(0,rand(2,3));
    }

    let status;
    if (rec==='BLOCK') status='blocked';
    else if (dayOff>10) status=Math.random()<(rec==='APPROVE'?0.82:0.65)?'delivered':'rto';
    else if (dayOff>3)  status=rec==='APPROVE'?'approved':'verified';
    else                status='pending';

    const ruleScore = Math.min(100, randF(riskScore*0.7, riskScore*1.1));
    const statScore = Math.min(100, randF(riskScore*0.7, riskScore*1.1));
    const mlScore   = Math.min(100, randF(riskScore*0.8, riskScore*1.05));

    const riskSummary = rec==='APPROVE'
      ? `Low risk COD order from ${city}. No fraud signals detected.`
      : rec==='VERIFY'
      ? `Order flagged for review: ${signals[0]?.signal?.replace(/_/g,' ')||'risk factor detected'}.`
      : `BLOCKED: ${signals.map(s=>s.signal.replace(/_/g,' ')).join(', ')}.`;

    orders.push([
      id, tenantId, `SHF${100001+i}`, 'shopify',
      JSON.stringify({source:'shopify_webhook'}),
      name, `${name.split(' ')[0].toLowerCase()}${rand(10,99)}@gmail.com`,
      phone, phone_n,
      JSON.stringify({address1:`House ${rand(1,500)}, Street ${rand(1,50)}`,city,country:'PK'}),
      city, 'PK', payment, 'PKR', amount, qty,
      JSON.stringify([{name:product,quantity:qty,price:amount,category:cat.slug}]),
      riskScore, riskLevel, rec,
      JSON.stringify(signals), riskSummary, status,
      createdAt, createdAt, createdAt,
    ]);

    scores.push([
      randomUUID(), id, tenantId,
      ruleScore, statScore, mlScore, riskScore,
      parseFloat((Math.abs(riskScore/100-0.5)*2).toFixed(4)),
      JSON.stringify(signals), MODEL_VER, createdAt, rand(85,420),
    ]);
  }
  return { orders, scores };
}

// ─── Batch INSERT helpers ─────────────────────────────────────────────────────
async function batchInsert(client, table, colCount, rows) {
  if (!rows.length) return;
  const placeholders = rows.map((_, ri) =>
    `(${Array.from({length:colCount},(_,ci)=>`$${ri*colCount+ci+1}`).join(',')})`
  ).join(',');
  const flat = rows.flat();
  await client.query(`INSERT INTO ${table} VALUES ${placeholders}`, flat);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 COD Fraud Shield — Category Demo Seeder\n');
  console.log(`   Creating ${CATEGORIES.length} demo accounts × ${ORDERS_EACH} orders each\n`);

  const passwordHash = createHash('sha256').update(PASSWORD).digest('hex');
  const client = await pool.connect();
  const results = [];

  try {
    for (const [idx, cat] of CATEGORIES.entries()) {
      process.stdout.write(`\r[${idx+1}/${CATEGORIES.length}] ${cat.name.padEnd(35)}`);

      await client.query('BEGIN');

      // Delete existing by slug
      const existingTenant = await client.query(
        `SELECT id FROM tenants WHERE slug=$1`, [cat.slug]
      );
      if (existingTenant.rows.length) {
        const oldId = existingTenant.rows[0].id;
        await client.query(`DELETE FROM performance_snapshots WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM prediction_logs       WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM risk_logs             WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM rto_reports           WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM fraud_scores          WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM blacklist             WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM addresses             WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM orders                WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM shopify_connections   WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM api_keys              WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM users                 WHERE tenant_id=$1`,[oldId]);
        await client.query(`DELETE FROM tenants               WHERE id=$1`,[oldId]);
      }

      // Create tenant
      const tenantId = randomUUID();
      await client.query(
        `INSERT INTO tenants(id,name,slug,plan,order_limit,orders_used,is_active)
         VALUES($1,$2,$3,'enterprise',100000,$4,true)`,
        [tenantId, `${cat.name} Demo Store`, cat.slug, ORDERS_EACH]
      );

      // Create user
      const userId = randomUUID();
      await client.query(
        `INSERT INTO users(id,tenant_id,email,password_hash,name,role,is_active)
         VALUES($1,$2,$3,$4,$5,'owner',true)`,
        [userId, tenantId, cat.email, passwordHash, `${cat.name} Demo`]
      );

      // Shopify connection
      await client.query(
        `INSERT INTO shopify_connections(id,tenant_id,shop,access_token,scopes,installed_at)
         VALUES($1,$2,$3,$4,'read_orders,write_orders',$5)`,
        [randomUUID(), tenantId, cat.store, `shpat_demo_${cat.slug.replace(/-/g,'_')}`, new Date(Date.now()-92*86400000)]
      );

      // Generate + batch insert orders
      const { orders, scores } = genOrders(cat, tenantId);

      // 28 columns for orders
      const ORDER_COLS = `(id,tenant_id,external_order_id,platform,platform_data,
        customer_name,customer_email,customer_phone,phone_normalized,
        shipping_address,shipping_city,shipping_country,
        payment_method,currency,total_amount,items_count,line_items,
        risk_score,risk_level,recommendation,fraud_signals,risk_summary,
        status,scored_at,created_at,updated_at)`;

      const placeholdersO = orders.map((_,ri)=>
        `(${Array.from({length:26},(_,ci)=>`$${ri*26+ci+1}`).join(',')})`
      ).join(',');
      await client.query(`INSERT INTO orders ${ORDER_COLS} VALUES ${placeholdersO}`, orders.flat());

      // 12 columns for fraud_scores
      const SCORE_COLS = `(id,order_id,tenant_id,rule_score,statistical_score,ml_score,final_score,confidence,signals,ml_model_version,scored_at,scoring_duration_ms)`;
      const placeholdersS = scores.map((_,ri)=>
        `(${Array.from({length:12},(_,ci)=>`$${ri*12+ci+1}`).join(',')})`
      ).join(',');
      await client.query(`INSERT INTO fraud_scores ${SCORE_COLS} VALUES ${placeholdersS}`, scores.flat());

      await client.query('COMMIT');
      results.push({ ...cat, tenantId });
    }

    console.log('\n\n✅ All categories seeded!\n');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('  DEMO ACCOUNTS — All use password: Demo4400F');
    console.log('═══════════════════════════════════════════════════════════════════════');
    results.forEach(r => {
      console.log(`  ${r.email.padEnd(35)} → ${r.name}`);
    });
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  Total: ${CATEGORIES.length} accounts × ${ORDERS_EACH} orders = ${CATEGORIES.length*ORDERS_EACH} orders`);
    console.log(`  URL: https://cod-fraud-saas.vercel.app`);
    console.log('═══════════════════════════════════════════════════════════════════════\n');

  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('\n❌ Error:', err.message, err.stack);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
