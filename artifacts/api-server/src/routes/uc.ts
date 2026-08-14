import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __ucRouteDirname = dirname(fileURLToPath(import.meta.url));
const UC_DATA_DIR = join(__ucRouteDirname, "../../../data");
import {
  validateCodeForDiscount,
  recordReferralConversion,
  registerReferralAtSignup,
} from "./referrals";
import { sanitiseCsvCell } from "./uc-water-chat.js";
import { issueToken, verifyToken } from "../lib/jwt.js";
import { authLimiter, lookupLimiter } from "../lib/rate-limiters.js";
import {
  sendSms,
  orderConfirmationSms,
  ticketConfirmationSms,
  waterTestConfirmationSms,
} from "../lib/sms.js";
import {
  sendEmail,
  buildOrderReceiptEmail,
  buildTicketConfirmationEmail,
  buildWaterTestConfirmationEmail,
} from "../lib/email.js";
import { sendViaResend } from "../lib/resend.js";
import {
  pool,
  db,
  ucPushTokensTable, ucEnquiriesTable, ucNotifPrefsTable,
  ucUsersTable, ucOrdersTable, ucOrderItemsTable, ucTicketsTable, ucWaterTestsTable,
  ucReviewsTable, ucProductMediaTable, ucNotificationLogTable, mpesaStkInitiationsTable,
  type ReviewMediaItem, type UcProductMedia,
} from "@workspace/db";
import { eq, desc, inArray, notInArray, and, asc, ne, gt, or, sql } from "drizzle-orm";
import bcryptjs from "bcryptjs";
import { logger } from "../lib/logger";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router = Router();

// ─── Mock data ────────────────────────────────────────────────────────────────
// Real Ultra Clear 2026 product catalogue — 5 segments, 27 products.
// When WooCommerce credentials are present these are bypassed entirely.
const CAT_BOTTLES   = { id: 1, name: "Bottles & Portable" };
const CAT_HOME      = { id: 2, name: "Home Filters" };
const CAT_SHOWER    = { id: 3, name: "Shower & Skin" };
const CAT_ACCESS    = { id: 4, name: "Accessories" };
const CAT_SOLUTIONS = { id: 5, name: "Solutions" };

const MOCK_PRODUCTS: Record<string, unknown>[] = [
  // ── Segment 01 · Bottles & Portable Filters ──────────────────────────────
  {
    id: 1, name: "Hydra Flux", sku: "UC-BTL-HFX-001",
    price: "3499", regularPrice: "3499", salePrice: "",
    lifespanDays: 90,
    tagline: "Certified hydration, elevated.",
    description: "750ml BPA-free filter bottle with SGS-certified >99.9% bacteria removal. Ahlstrom Disruptor® filter. 60-second cartridge swap. Available in 4 colours. Filter: 150L or 3 months — whichever comes first.",
    shortDescription: "750ml certified filter bottle — 4 colours",
    categories: [CAT_BOTTLES],
    images: [{ src: "/api/uc/product-images/hydra-flux-premium-filter-bottle.jpg", alt: "Hydra Flux" }],
    stockStatus: "instock", stockQuantity: 30,
    tags: [{ name: "bestseller" }],
  },
  {
    id: 2, name: "Truva Go", sku: "UC-BTL-TGO-002",
    price: "2599", regularPrice: "2599", salePrice: "",
    lifespanDays: 90,
    tagline: "Slim. Certified. Goes everywhere you go.",
    description: "Slim 750ml BPA-free filter bottle for urban commuters. Fits any bike holder or bag. Ahlstrom Disruptor® filter. 60-second filter replacement. SGS-certified. Filter: 150L or 3 months.",
    shortDescription: "Slim 750ml certified filter bottle for commuters",
    categories: [CAT_BOTTLES],
    images: [{ src: "/api/uc/product-images/truva-go-slim-filter-bottle.jpg", alt: "Truva Go" }],
    stockStatus: "instock", stockQuantity: 25,
    tags: [],
  },
  {
    id: 3, name: "Viva Drop", sku: "UC-BTL-VDP-003",
    price: "2199", regularPrice: "2199", salePrice: "",
    lifespanDays: 90,
    tagline: "Compact. Certified. Carry it everywhere.",
    description: "Compact 500ml BPA-free filter bottle for desk, commute, campus, and gym. Ahlstrom Disruptor® filter with SGS-certified bacteria removal. Replaces daily plastic bottle purchases. Filter: 150L or 3 months.",
    shortDescription: "500ml compact certified filter bottle",
    categories: [CAT_BOTTLES],
    images: [{ src: "/api/uc/product-images/viva-drop-compact-filter-bottle.jpg", alt: "Viva Drop" }],
    stockStatus: "instock", stockQuantity: 40,
    tags: [],
  },
  {
    id: 4, name: "Flex", sku: "UC-BTL-FLX-004",
    price: "2399", regularPrice: "2399", salePrice: "",
    lifespanDays: 90,
    tagline: "1 litre. Squeezable. Certified clean.",
    description: "1000ml squeezable BPA-free filter bottle. Ahlstrom Disruptor® filter with SGS-certified bacteria removal. Great for hiking, travel, and outdoor use. Filter: 150L or 3 months.",
    shortDescription: "1L squeezable certified filter bottle",
    categories: [CAT_BOTTLES],
    images: [{ src: "/api/uc/product-images/flex-squeezable-filter-bottle.jpg", alt: "Flex" }],
    stockStatus: "instock", stockQuantity: 20,
    tags: [],
  },
  {
    id: 5, name: "Timbo", sku: "UC-BTL-TMB-005",
    price: "1299", regularPrice: "1299", salePrice: "",
    lifespanDays: 90,
    tagline: "350ml. Kids. Certified safe.",
    description: "350ml BPA-free kids' filter bottle. SGS-certified bacteria removal keeps your child's water safe at school, sports, and on the go. Easy-squeeze design. Filter: 150L or 3 months.",
    shortDescription: "350ml kids' certified filter bottle",
    categories: [CAT_BOTTLES],
    images: [{ src: "/api/uc/product-images/timbo-kids-filter-bottle.jpg", alt: "Timbo" }],
    stockStatus: "instock", stockQuantity: 35,
    tags: [],
  },
  {
    id: 6, name: "Gym Buddy", sku: "UC-BTL-GYM-006",
    price: "2799", regularPrice: "2799", salePrice: "",
    lifespanDays: 90,
    tagline: "1.2L. Certified. Built for the grind.",
    description: "1200ml motivational filter bottle for gym-goers and athletes. SGS-certified bacteria removal. Wide-mouth design for ice. Ahlstrom Disruptor® filter. Filter: 150L or 3 months.",
    shortDescription: "1.2L motivational certified filter bottle",
    categories: [CAT_BOTTLES],
    images: [{ src: "/api/uc/product-images/gym-buddy-1-2l-training-filter-bottle.jpg", alt: "Gym Buddy" }],
    stockStatus: "instock", stockQuantity: 20,
    tags: [],
  },
  {
    id: 7, name: "Survivor Straw", sku: "UC-STR-SVV-007",
    price: "1299", regularPrice: "1299", salePrice: "",
    lifespanDays: 120,
    tagline: "Drink safe from any source.",
    description: "Portable emergency filter straw. SGS-certified filtration — drink directly from streams, taps, or any water source. Lightweight and compact. Filter: 400L or 4 months — whichever comes first.",
    shortDescription: "Portable certified emergency filter straw",
    categories: [CAT_BOTTLES],
    images: [{ src: "/api/uc/product-images/survivor-straw-filter.jpg", alt: "Survivor Straw" }],
    stockStatus: "instock", stockQuantity: 50,
    tags: [],
  },
  {
    id: 8, name: "Breeze", sku: "UC-BTL-BRZ-008",
    price: "1699", regularPrice: "1699", salePrice: "",
    lifespanDays: 90,
    tagline: "Entry-level certified filtration.",
    description: "500ml entry-level BPA-free filter bottle. SGS-certified bacteria removal. Ideal first certified filter bottle. Ahlstrom Disruptor® filter. Filter: 150L or 3 months.",
    shortDescription: "500ml entry-level certified filter bottle",
    categories: [CAT_BOTTLES],
    images: [{ src: "/api/uc/product-images/breeze-filter-bottle.jpg", alt: "Breeze" }],
    stockStatus: "instock", stockQuantity: 45,
    tags: [],
  },
  {
    id: 9, name: "EcoSmart Elite", sku: "UC-ESE-ELT-009",
    price: "9799", regularPrice: "9799", salePrice: "",
    lifespanDays: 90,
    tagline: "Solar. Electric. Always clean.",
    description: "Advanced portable filter with solar charging, electric pump, and built-in power bank. Multi-stage filtration: Nylon Mesh, UF Membrane 0.01µm, Ahlstrom Disruptor®, Carbon Block. Filter: 400L or 3 months — whichever comes first.",
    shortDescription: "Solar-powered certified portable filter with power bank",
    categories: [CAT_BOTTLES],
    images: [{ src: "/api/uc/product-images/ecosmart-elite-field-purifier.jpg", alt: "EcoSmart Elite" }],
    stockStatus: "instock", stockQuantity: 10,
    tags: [{ name: "premium" }],
  },

  // ── Segment 02 · Home Water Filters ──────────────────────────────────────
  {
    id: 11, name: "Sweet Home", sku: "UC-FCT-SWH-011",
    price: "3699", regularPrice: "3699", salePrice: "",
    lifespanDays: 120,
    tagline: "Your tap. Certified. In under 5 minutes.",
    description: "Clips onto your kitchen tap in under 5 minutes — no tools, no plumber, no drilling. SGS-certified >99.9% bacteria removal. Removes chlorine, sediment, and selected heavy metals that boiling leaves behind. Filter: 4–5 months.",
    shortDescription: "Faucet filter — tool-free, SGS-certified, 4–5 month filter",
    categories: [CAT_HOME],
    images: [{ src: "/api/uc/product-images/sweet-home-faucet-filter.jpg", alt: "Sweet Home" }],
    stockStatus: "instock", stockQuantity: 30,
    tags: [{ name: "bestseller" }],
  },
  {
    id: 12, name: "Counter Reverse Osmosis", sku: "UC-HOM-CRO-012",
    price: "38999", regularPrice: "38999", salePrice: "",
    lifespanDays: 180,
    tagline: "Full RO purity. No drilling. No plumber.",
    description: "Counter-top reverse osmosis delivering multi-stage RO-grade purity without under-sink installation. Sits on your kitchen counter, connects to any standard tap. Removes bacteria, dissolved solids, heavy metals, and chlorine. Ideal for renters and apartments. SGS-certified. Filter: 6 months.",
    shortDescription: "Counter-top RO — no plumbing, SGS-certified, 6-month filter",
    categories: [CAT_HOME],
    images: [{ src: "/api/uc/product-images/counter-reverse-osmosis-system.jpg", alt: "Counter Reverse Osmosis" }],
    stockStatus: "instock", stockQuantity: 8,
    tags: [{ name: "premium" }],
  },
  {
    id: 13, name: "Electric Pitcher", sku: "UC-PCT-ELP-013",
    price: "10999", regularPrice: "10999", salePrice: "",
    lifespanDays: 90,
    tagline: "Counter-top certified water. No installation required.",
    description: "Ultra Clear's counter-top electric filtration pitcher — certified clean water without any tap attachment or installation. Fill from your kitchen tap, press to filter, pour certified clean. Multi-stage filtration with SGS-certified performance. Filter: 400L or 3 months.",
    shortDescription: "Electric counter-top filter pitcher — no installation",
    categories: [CAT_HOME],
    images: [{ src: "/api/uc/product-images/electric-pitcher-counter-top-filter.jpg", alt: "Electric Pitcher" }],
    stockStatus: "instock", stockQuantity: 12,
    tags: [],
  },
  {
    id: 14, name: "RO Home System", sku: "UC-ROS-HOM-022",
    price: "0", regularPrice: "0", salePrice: "",
    lifespanDays: 180,
    enquiryOnly: true,
    tagline: "Whole-home certified purity. Under the sink.",
    description: "Under-sink reverse osmosis home filtration in 50G, 75G, and 100G configurations. Multi-stage RO filtration removing bacteria, heavy metals, dissolved solids, and chlorine. Professional installation by Ultra Clear. Annual maintenance contract available. Filter: 6 months. Contact info@ucfilters.com for site assessment.",
    shortDescription: "Under-sink RO system — 50G/75G/100G, professional installation",
    categories: [CAT_HOME],
    images: [{ src: "/api/uc/product-images/ro-home-system.jpg", alt: "RO Home System" }],
    stockStatus: "instock", stockQuantity: 5,
    tags: [],
  },

  // ── Segment 03 · Shower & Skin Filters ───────────────────────────────────
  {
    id: 15, name: "J'adore", sku: "UC-SHW-JAD-015",
    price: "4399", regularPrice: "4399", salePrice: "",
    lifespanDays: 150,
    tagline: "Certified softer water. Every shower.",
    description: "Shower filter delivering SGS-certified >95% chlorine removal. Multi-layer filtration media: PP Cotton, KDF, Activated Carbon, Vitamin C. Universal attachment — fits any shower head. Filter: 5 months.",
    shortDescription: "Shower filter — 5-month filter, SGS-certified >95% chlorine removal",
    categories: [CAT_SHOWER],
    images: [{ src: "/api/uc/product-images/jadore-aluminium-shower-filter.jpg", alt: "J'adore" }],
    stockStatus: "instock", stockQuantity: 20,
    tags: [],
  },
  {
    id: 16, name: "Channel", sku: "UC-SHW-DFF-016",
    price: "3699", regularPrice: "3699", salePrice: "",
    lifespanDays: 135,
    tagline: "Purer water. Purer skincare results.",
    description: "Dedicated facial basin filter — SGS-certified >95% chlorine removal at the precise point your skincare routine begins and ends. The water used to cleanse and rinse your face affects how every product performs. Remove the chlorine first. Filter: 4–5 months.",
    shortDescription: "Facial basin filter — removes chlorine at the source of your skincare",
    categories: [CAT_SHOWER],
    images: [{ src: "/api/uc/product-images/channel-facial-basin-filter.jpg", alt: "Channel" }],
    stockStatus: "instock", stockQuantity: 18,
    tags: [],
  },
  {
    id: 17, name: "Derma Care", sku: "UC-SHW-DCR-017",
    price: "3299", regularPrice: "3299", salePrice: "",
    lifespanDays: 150,
    tagline: "Gentler water for sensitive skin, every day.",
    description: "Shower filter designed for sensitive, dry, and eczema-prone skin. SGS-certified >95% chlorine removal to reduce the daily chemical load that tap water places on vulnerable skin and scalp. Universal attachment. Filter: 5 months.",
    shortDescription: "Shower filter for sensitive skin — 5-month, SGS-certified",
    categories: [CAT_SHOWER],
    images: [{ src: "/api/uc/product-images/derma-care-shower-filter.jpg", alt: "Derma Care" }],
    stockStatus: "instock", stockQuantity: 15,
    tags: [],
  },
  {
    id: 18, name: "Pure Drop", sku: "UC-SKW-SHF-022",
    price: "2699", regularPrice: "2699", salePrice: "",
    lifespanDays: 150,
    tagline: "Certified clean. Simple. Every shower.",
    description: "SGS-certified shower filter delivering >95% chlorine removal with an easy universal attachment. Compact, lightweight design fits any shower head with no tools. 5-month filter life. The entry point to certified shower water. Filter media: PP Cotton, KDF, Activated Carbon.",
    shortDescription: "Entry-level shower filter — 5-month, universal fit",
    categories: [CAT_SHOWER],
    images: [{ src: "/api/uc/product-images/pure-drop-shower-filter.jpg", alt: "Pure Drop" }],
    stockStatus: "instock", stockQuantity: 25,
    tags: [],
  },
  {
    id: 19, name: "Derma Flux", sku: "UC-SKW-DFS-024",
    price: "6499", regularPrice: "6499", salePrice: "",
    lifespanDays: 135,
    tagline: "Softer water at the source. For every skincare ritual.",
    description: "Faucet-mounted facial filter with SGS-certified >95% chlorine removal at your basin. 6-layer precision filtration: PP Cotton, Carbon Fibre, KDF, Vitamin C, PSS, and UF Membrane. Tool-free install. Perspective window shows condition in real time — swap when colour shifts. Filter: 4–5 months.",
    shortDescription: "Faucet facial filter — 6-layer, perspective window, 4–5 months",
    categories: [CAT_SHOWER],
    images: [{ src: "/api/uc/product-images/derma-flux-faucet-facial-filter.jpg", alt: "Derma Flux" }],
    stockStatus: "instock", stockQuantity: 12,
    tags: [{ name: "premium" }],
  },

  // ── Segment 04 · Accessories & Replacements ──────────────────────────────
  {
    id: 20, name: "Gift & Bundle Sets", sku: "UC-ACC-GFT-020",
    price: "0", regularPrice: "0", salePrice: "",
    lifespanDays: 0,
    enquiryOnly: true,
    tagline: "The gift of certified clean water.",
    description: "Curated gift and bundle sets — mix and match Ultra Clear products. Filter lifespan varies by bundle contents. Contact us to build your perfect bundle.",
    shortDescription: "Mix & match gift bundles — contact us for pricing",
    categories: [CAT_ACCESS],
    images: [{ src: "/api/uc/product-images/gift-and-bundle-sets.jpg", alt: "Gift Sets" }],
    stockStatus: "instock", stockQuantity: 999,
    tags: [],
  },
  {
    id: 21, name: "Bottle Carry Sleeve", sku: "UC-ACC-SLV-021",
    price: "0", regularPrice: "0", salePrice: "",
    lifespanDays: 0,
    enquiryOnly: true,
    tagline: "Protect your bottle in style.",
    description: "Neoprene and crochet carry sleeves in universal fit for all Ultra Clear bottles. No filter media — housing accessory only. Price on request.",
    shortDescription: "Neoprene & crochet bottle sleeve — universal fit",
    categories: [CAT_ACCESS],
    images: [{ src: "/api/uc/product-images/ultra-clear-bottle-carry-sleeve-crocheted.jpg", alt: "Bottle Carry Sleeve" }],
    stockStatus: "instock", stockQuantity: 999,
    tags: [],
  },
  {
    id: 22, name: "Bottle Filter Cartridge", sku: "UC-RPL-BTL-010",
    price: "1099", regularPrice: "1099", salePrice: "",
    lifespanDays: 90,
    tagline: "Genuine replacement. Keep the certification active.",
    description: "Genuine Ahlstrom Disruptor® replacement cartridge for all Ultra Clear filter bottles (Hydra Flux, Truva Go, Viva Drop, Flex, Timbo, Gym Buddy, Breeze). Maintains SGS-certified >99.9% bacteria removal. Replace every 150L or 3 months.",
    shortDescription: "Genuine replacement cartridge for all UC filter bottles — 3 months",
    categories: [CAT_ACCESS],
    images: [{ src: "/api/uc/product-images/bottle-filter-cartridge.jpg", alt: "Bottle Filter Cartridge" }],
    stockStatus: "instock", stockQuantity: 100,
    tags: [{ name: "replacement" }, { name: "bestseller" }],
  },
  {
    id: 23, name: "Faucet Filter Cartridge", sku: "UC-RPL-FCT-014",
    price: "1999", regularPrice: "1999", salePrice: "",
    lifespanDays: 120,
    tagline: "Replace every 4–5 months. Keep the certification active.",
    description: "Genuine replacement cartridge for the Sweet Home Faucet Filter. Maintains SGS-certified >99.9% bacteria removal and >95% chlorine removal performance. Replace every 4–5 months or ~1,500–2,000 litres. Ultra Clear replacement reminders included.",
    shortDescription: "Genuine replacement cartridge for Sweet Home faucet filter — 4–5 months",
    categories: [CAT_ACCESS],
    images: [{ src: "/api/uc/product-images/home-sweet-home-faucet-filter-cartridge.jpg", alt: "Faucet Filter Cartridge" }],
    stockStatus: "instock", stockQuantity: 80,
    tags: [{ name: "replacement" }],
  },
  {
    id: 24, name: "Shower Filter Cartridge", sku: "UC-RPL-SHW-018",
    price: "1499", regularPrice: "1499", salePrice: "",
    lifespanDays: 150,
    tagline: "Replace every 5 months. Keep every shower certified.",
    description: "Genuine replacement cartridge for the J'adore, Derma Care, and Pure Drop shower and basin filters. Maintains SGS-certified >95% chlorine removal. Multi-layer filtration media: PP Cotton, KDF, Activated Carbon, Vitamin C. Replace every 5 months.",
    shortDescription: "Genuine shower cartridge for J'adore, Derma Care, Pure Drop — 5 months",
    categories: [CAT_ACCESS],
    images: [{ src: "/api/uc/product-images/shower-filter-cartridge.jpg", alt: "Shower Filter Cartridge" }],
    stockStatus: "instock", stockQuantity: 60,
    tags: [{ name: "replacement" }],
  },
  {
    id: 25, name: "Derma Flux Cartridge", sku: "UC-SKW-DFO-025",
    price: "2499", regularPrice: "2499", salePrice: "",
    lifespanDays: 120,
    tagline: "Replace every 4 months. Keep the skincare edge.",
    description: "Genuine replacement cartridge for the Derma Flux facial faucet filter. Precision 6-layer filtration: PP Cotton, Carbon Fibre, KDF, Vitamin C, PSS, and UF Membrane. Perspective window shows condition — swap when colour shifts. Maintains SGS-certified >95% chlorine removal. Replace every 4–5 months.",
    shortDescription: "Genuine 6-layer replacement cartridge for Derma Flux — 4–5 months",
    categories: [CAT_ACCESS],
    images: [{ src: "/api/uc/product-images/derma-flux-filter-cartridge.jpg", alt: "Derma Flux Cartridge" }],
    stockStatus: "instock", stockQuantity: 40,
    tags: [{ name: "replacement" }],
  },
  {
    id: 26, name: "Survivor Straw Cartridge", sku: "UC-BOG-FCS-017",
    price: "499", regularPrice: "499", salePrice: "",
    // Matches Survivor Straw: 400L or 4 months.
    lifespanDays: 120,
    tagline: "Renew the straw. Restore the protection.",
    description: "Genuine replacement filter cartridge for the Ultra Clear Survivor Straw. Restores full SGS-certified filtration performance. Compact, lightweight, and easy to swap in the field. Replace every 400L or 4 months — whichever comes first.",
    shortDescription: "Genuine replacement cartridge for Survivor Straw",
    categories: [CAT_ACCESS],
    images: [{ src: "/api/uc/product-images/survivor-straw-filter-cartridge.jpg", alt: "Survivor Straw Cartridge" }],
    stockStatus: "instock", stockQuantity: 100,
    tags: [{ name: "replacement" }],
  },
  {
    id: 27, name: "Filter Shell", sku: "UC-BOG-SHL-018",
    price: "499", regularPrice: "499", salePrice: "",
    lifespanDays: 0,
    tagline: "The shell that carries the clean.",
    description: "Replacement outer shell for the Survivor Straw filter. Durable BPA-free housing with universal thread fit — pair with a fresh Survivor Straw Cartridge for a fully rebuilt straw at minimal cost. Lightweight and compact.",
    shortDescription: "Replacement housing shell for Survivor Straw",
    categories: [CAT_ACCESS],
    images: [{ src: "/api/uc/product-images/filter-shell-straw-shell.jpg", alt: "Filter Shell" }],
    stockStatus: "instock", stockQuantity: 50,
    tags: [],
  },

  // ── Segment 05 · Solutions ────────────────────────────────────────────────
  {
    id: 29, name: "Aqua Stream 1200", sku: "UC-COM-UP-027",
    price: "69990", regularPrice: "69990", salePrice: "",
    lifespanDays: 210,
    tagline: "Institutional-grade certified water. Zero management overhead.",
    description: "Commercial reverse osmosis infrastructure for 50–200+ staff. Two configurations: Aqua Stream 1200 at KES 69,990 and Aqua Stream 1200 Pro on request. Full documentation pack (SGS, FDA, RoHS) within 24 hours. Annual ESG impact statement for corporate reporting. Site assessment, installation, and maintenance contract available. Filter: 6–9 months.",
    shortDescription: "Commercial 1200GPD RO system — KES 69,990 / Pro on request",
    categories: [CAT_SOLUTIONS],
    images: [{ src: "/api/uc/product-images/aqua-stream-1200-commercial-ro-system.jpg", alt: "Aqua Stream 1200" }],
    stockStatus: "instock", stockQuantity: 3,
    tags: [{ name: "commercial" }],
  },
  {
    id: 30, name: "Water ATMs", sku: "UC-ATM-001",
    price: "0", regularPrice: "0", salePrice: "",
    lifespanDays: 0,
    enquiryOnly: true,
    tagline: "KES 2–5 per litre. Certified. For every community.",
    description: "Pay-per-litre certified water infrastructure. Ultra Clear Water ATMs bring SGS-certified filtered water to communities at KES 2–5 per litre. Host and placement enquiries: info@ucfilters.com.",
    shortDescription: "Community certified water ATMs — host enquiries welcome",
    categories: [CAT_SOLUTIONS],
    images: [{ src: "/api/uc/product-images/ultra-clear-water-atm.jpg", alt: "Water ATMs" }],
    stockStatus: "instock", stockQuantity: 0,
    tags: [{ name: "commercial" }],
  },
];

const MOCK_LOCATIONS = [
  { id: "loc1", type: "experience_centre", name: "UC Experience Centre Westlands", address: "Woodvale Groove, Westlands, Nairobi", lat: -1.2633, lng: 36.8072, hours: "Mon–Sat 8am–6pm, Sun 10am–4pm", phone: "+254 700 123456" },
  { id: "loc2", type: "experience_centre", name: "UC Service Centre Karen", address: "Karen Hardy Estate, Karen, Nairobi", lat: -1.3319, lng: 36.7097, hours: "Mon–Fri 8am–5pm", phone: "+254 700 654321" },
  { id: "loc3", type: "refill_atm", name: "Water ATM – Village Market", address: "Village Market Mall, Limuru Rd, Gigiri", lat: -1.2194, lng: 36.8083, hours: "24/7", phone: null },
  { id: "loc4", type: "refill_atm", name: "Water ATM – Sarit Centre", address: "Sarit Centre, Karuna Rd, Westlands", lat: -1.2592, lng: 36.8027, hours: "6am–11pm daily", phone: null },
  { id: "loc5", type: "refill_atm", name: "Water ATM – Two Rivers Mall", address: "Two Rivers Mall, Rhapta Rd, Westlands", lat: -1.2178, lng: 36.7985, hours: "7am–10pm daily", phone: null },
  { id: "loc6", type: "refill_atm", name: "Water ATM – Garden City", address: "Garden City Mall, Thika Superhighway", lat: -1.2241, lng: 36.8801, hours: "6am–10pm daily", phone: null },
  { id: "loc7", type: "refill_atm", name: "Water ATM – Junction Mall", address: "Junction Mall, Ngong Rd, Nairobi", lat: -1.3003, lng: 36.7773, hours: "7am–9pm daily", phone: null },
];

// In-memory stores removed — all data now persists in PostgreSQL.
// Fallback arrays used only when the DB is temporarily unavailable.
const orderStoreFallback:  Record<string, unknown>[] = [];
const ticketStoreFallback: Record<string, unknown>[] = [];
const waterTestStoreFallback: Record<string, unknown>[] = [];

// ─── WooCommerce helpers ──────────────────────────────────────────────────────
export function hasWCCredentials(): boolean {
  return !!(process.env["WC_CONSUMER_KEY"] && process.env["WC_CONSUMER_SECRET"]);
}

function wcUrl(path: string, extra: Record<string, string> = {}): string {
  const base = process.env["WC_BASE_URL"] || "https://www.ucfilters.com";
  const url = new URL(`${base}/wp-json/wc/v3${path}`);
  url.searchParams.set("consumer_key", process.env["WC_CONSUMER_KEY"]!);
  url.searchParams.set("consumer_secret", process.env["WC_CONSUMER_SECRET"]!);
  Object.entries(extra).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

/**
 * Parse a WooCommerce REST API response that may have PHP notices prepended.
 * WordPress sites with WP_DEBUG enabled output HTML notices before the JSON body.
 * We scan for the first `[` or `{` and parse from there.
 */
function parseWcJson(text: string): unknown {
  const start = text.search(/[{[]/);
  if (start === -1) throw new SyntaxError("No JSON object found in WC response");
  return JSON.parse(text.slice(start));
}

async function wcFetchArray(
  path: string,
  extra: Record<string, string> = {}
): Promise<Record<string, unknown>[] | null> {
  try {
    const res = await fetch(wcUrl(path, extra));
    const text = await res.text();
    const data: unknown = parseWcJson(text);
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

async function wcFetchOne(
  path: string,
  extra: Record<string, string> = {}
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(wcUrl(path, extra));
    const text = await res.text();
    const data: unknown = parseWcJson(text);
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function normalizeProduct(p: Record<string, unknown>): Record<string, unknown> {
  // lifespanDays: present on mock products; for WooCommerce products we check
  // meta_data for a "filter_lifespan_days" key. 0 = not a trackable filter —
  // never guess a lifespan for unknown products (the mobile filter tracker
  // treats lifespanDays > 0 as "trackable" and schedules reminders from it).
  let lifespanDays: number = typeof p["lifespanDays"] === "number" ? p["lifespanDays"] : 0;
  if (Array.isArray(p["meta_data"])) {
    const meta = (p["meta_data"] as Array<{ key: string; value: unknown }>)
      .find(m => m.key === "filter_lifespan_days");
    if (meta && Number(meta.value) > 0) lifespanDays = Number(meta.value);
  }
  return {
    id: p["id"],
    name: p["name"],
    price: p["price"],
    regularPrice: p["regular_price"] ?? p["regularPrice"],
    salePrice: p["sale_price"] ?? p["salePrice"],
    description: p["description"],
    shortDescription: p["short_description"] ?? p["shortDescription"],
    tagline: p["tagline"] ?? p["short_description"] ?? p["shortDescription"] ?? "",
    categories: p["categories"],
    images: p["images"],
    sku: p["sku"],
    stockStatus: p["stock_status"] ?? p["stockStatus"],
    stockQuantity: p["stock_quantity"] ?? p["stockQuantity"],
    tags: p["tags"],
    lifespanDays,
    enquiryOnly: p["enquiryOnly"] ?? false,
    // WooCommerce lifetime sales counter — used by the mobile app to rank
    // recommendations. Mock products have no sales history → 0.
    totalSales: Number(p["total_sales"] ?? p["totalSales"] ?? 0) || 0,
  };
}

function normalizeOrder(o: Record<string, unknown>): Record<string, unknown> {
  const li = Array.isArray(o["line_items"])
    ? (o["line_items"] as Record<string, unknown>[]).map((i) => ({
        productId: i["product_id"],
        name: i["name"],
        quantity: i["quantity"],
        total: i["total"],
      }))
    : [];
  return {
    id: o["id"],
    status: o["status"],
    dateCreated: o["date_created"],
    total: o["total"],
    currency: o["currency"],
    paymentMethod: o["payment_method"],
    shippingAddress: o["shipping"],
    lineItems: li,
  };
}

// ─── Product media overlay ────────────────────────────────────────────────────
// Team-uploaded photos/videos stored in uc_product_media are merged on top of
// the base catalogue (mock or WooCommerce) so extra media survives a future
// switch to the live store. A DB hiccup must never take down the catalogue —
// failures are logged loudly and the base product is served unchanged.
async function fetchProductMediaMap(productIds: number[]): Promise<Map<number, UcProductMedia[]>> {
  const map = new Map<number, UcProductMedia[]>();
  if (productIds.length === 0) return map;
  try {
    const rows = await db
      .select()
      .from(ucProductMediaTable)
      .where(inArray(ucProductMediaTable.productId, productIds))
      .orderBy(asc(ucProductMediaTable.position), asc(ucProductMediaTable.id));
    for (const row of rows) {
      const list = map.get(row.productId) ?? [];
      list.push(row);
      map.set(row.productId, list);
    }
  } catch (err) {
    logger.error({ err }, "Failed to load product media overlay — serving base catalogue only");
  }
  return map;
}

function applyProductMedia(
  product: Record<string, unknown>,
  media: UcProductMedia[] | undefined,
): Record<string, unknown> {
  const baseImages = (product["images"] as { src: string; alt: string }[] | undefined) ?? [];
  if (!media || media.length === 0) {
    return { ...product, videoUrl: null };
  }
  const photos = media
    .filter((m) => m.type === "photo")
    .map((m) => ({ src: m.url, alt: m.alt || (product["name"] as string) }));
  const video = media.find((m) => m.type === "video");
  return { ...product, images: [...baseImages, ...photos], videoUrl: video?.url ?? null };
}

// ─── Products ─────────────────────────────────────────────────────────────────
router.get("/uc/products", async (req: Request, res: Response): Promise<void> => {
  try {
    let payload: Record<string, unknown>[] | null = null;
    if (hasWCCredentials()) {
      const extra: Record<string, string> = { per_page: "50" };
      if (req.query["category"]) extra["category"] = req.query["category"] as string;
      if (req.query["search"]) extra["search"] = req.query["search"] as string;
      const products = await wcFetchArray("/products", extra);
      if (products) payload = products.map(normalizeProduct);
    }
    if (!payload) {
      let data = MOCK_PRODUCTS;
      if (req.query["category"]) {
        const cat = (req.query["category"] as string).toLowerCase();
        data = data.filter((p) => {
          const cats = p["categories"] as { name: string }[] | undefined;
          return cats?.some((c) => c.name.toLowerCase() === cat);
        });
      }
      if (req.query["search"]) {
        const q = (req.query["search"] as string).toLowerCase();
        data = data.filter(
          (p) =>
            (p["name"] as string).toLowerCase().includes(q) ||
            (p["sku"] as string).toLowerCase().includes(q)
        );
      }
      payload = data;
    }
    const mediaMap = await fetchProductMediaMap(payload.map((p) => Number(p["id"])));
    res.json(payload.map((p) => applyProductMedia(p, mediaMap.get(Number(p["id"])))));
  } catch {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ─── Lifespan audit ───────────────────────────────────────────────────────────
// Replacement reminders depend on every live filter product carrying a
// `filter_lifespan_days` meta value (normalizeProduct → lifespanDays > 0).
// New products added to the store default to lifespanDays 0 (non-trackable)
// and would silently ship without reminders. This audit flags such products
// so the team can add the meta before customers miss reminders.
//
// Exempt (never flagged — these legitimately have no lifespan):
//   • enquiry-only products (enquiryOnly flag or zero/absent price)
//   • products whose only categories are accessory-type (no filter media)
const LIFESPAN_EXEMPT_CATEGORY = /accessor/i;

/**
 * Classify normalized products and return the ones that need a lifespan but
 * lack one. Exported for tests.
 */
export function auditProductLifespans(
  products: Record<string, unknown>[],
): Record<string, unknown>[] {
  return products.filter((p) => {
    if (Number(p["lifespanDays"]) > 0) return false; // already trackable
    if (p["enquiryOnly"]) return false; // enquiry-only → no reminders expected
    if (!(Number(p["price"]) > 0)) return false; // no purchasable price → enquiry-only in practice
    const cats = Array.isArray(p["categories"])
      ? (p["categories"] as { name?: unknown }[])
      : [];
    // Exempt when every category is accessory-type (a product also listed in a
    // filter category still gets flagged).
    if (
      cats.length > 0 &&
      cats.every((c) => LIFESPAN_EXEMPT_CATEGORY.test(String(c?.name ?? "")))
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Fetch every published product across all WooCommerce pages.
 *
 * WooCommerce caps `per_page` at 100, so stores with more products need
 * pagination. Returns null when ANY page fails — a partial catalogue must
 * never produce a false all-clear audit.
 *
 * `fetchPage` is injectable for tests; defaults to the live wcFetchArray.
 * Exported for tests.
 */
export async function fetchAllPublishedProducts(
  fetchPage: (page: number) => Promise<Record<string, unknown>[] | null> = (page) =>
    wcFetchArray("/products", {
      per_page: "100",
      status: "publish",
      page: String(page),
    }),
): Promise<Record<string, unknown>[] | null> {
  const all: Record<string, unknown>[] = [];
  const MAX_PAGES = 50; // 5,000 products — hard safety cap
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(page);
    if (batch === null) return null; // page unreachable → whole audit fails
    all.push(...batch);
    if (batch.length < 100) return all; // short page = last page, catalogue complete
  }
  // Reached the cap with every page full — the catalogue may extend beyond
  // what we fetched. Fail loudly rather than audit a partial catalogue and
  // report a false all-clear.
  return null;
}

// ─── Product lifespan map (cached) ───────────────────────────────────────────
// Shared lookup of productId → filter_lifespan_days for the impact calculator
// and receipt-based filter registration. Sources the same catalogue as
// /uc/products (live WooCommerce when credentials exist, mock otherwise) so
// lifespans are never guessed — products without the meta simply aren't in
// the map. Cached for 10 minutes; on a live-store outage the last good map is
// served, and `null` is returned only when no data has ever been fetched
// (callers must fail loudly, not fabricate lifespans).
let _lifespanCache: { at: number; map: Map<number, number> } | null = null;
let _lifespanRefresh: Promise<Map<number, number> | null> | null = null;
const LIFESPAN_CACHE_TTL_MS = 10 * 60 * 1000;

export async function getProductLifespanMap(): Promise<Map<number, number> | null> {
  if (_lifespanCache && Date.now() - _lifespanCache.at < LIFESPAN_CACHE_TTL_MS) {
    return _lifespanCache.map;
  }
  // Coalesce concurrent refreshes — at TTL expiry, impact + registration
  // requests must not each paginate the whole Woo catalogue.
  if (_lifespanRefresh) return _lifespanRefresh;
  _lifespanRefresh = (async () => {
    try {
      let normalized: Record<string, unknown>[] | null = null;
      if (hasWCCredentials()) {
        const products = await fetchAllPublishedProducts();
        if (products) normalized = products.map(normalizeProduct);
      } else {
        normalized = MOCK_PRODUCTS.map(normalizeProduct);
      }
      if (!normalized) return _lifespanCache?.map ?? null; // stale beats nothing
      const map = new Map<number, number>();
      for (const p of normalized) {
        const lifespan = Number(p["lifespanDays"]);
        if (lifespan > 0) map.set(Number(p["id"]), lifespan);
      }
      // Timestamp on completion — never on fetch start — so a slow fetch
      // can't shorten the effective freshness window.
      _lifespanCache = { at: Date.now(), map };
      return map;
    } finally {
      _lifespanRefresh = null;
    }
  })();
  return _lifespanRefresh;
}

/** Test hook — reset the lifespan cache between test cases. */
export function _resetLifespanCacheForTests(): void {
  _lifespanCache = null;
  _lifespanRefresh = null;
}

// GET /api/uc/admin/products/lifespan-audit — admin-only report of live
// products missing the filter_lifespan_days meta. ProjectHub surfaces this
// as a dashboard warning so new store products can't ship untracked.
router.get(
  "/uc/admin/products/lifespan-audit",
  async (req: Request, res: Response): Promise<void> => {
    const admin = await isAdminRequest(req.headers["authorization"]);
    if (!admin) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    try {
      let source = "mock";
      let normalized: Record<string, unknown>[] | null = null;
      if (hasWCCredentials()) {
        const products = await fetchAllPublishedProducts();
        if (products) {
          normalized = products.map(normalizeProduct);
          source = "woocommerce";
        } else {
          // Store unreachable — say so loudly instead of silently auditing
          // the mock catalogue and reporting a false all-clear.
          res.status(502).json({ error: "Could not reach the WooCommerce store to audit products" });
          return;
        }
      }
      if (!normalized) normalized = MOCK_PRODUCTS.map(normalizeProduct);

      const missing = auditProductLifespans(normalized).map((p) => ({
        id: p["id"],
        name: p["name"],
        sku: p["sku"] ?? "",
        categories: Array.isArray(p["categories"])
          ? (p["categories"] as { name?: string }[]).map((c) => c?.name ?? "")
          : [],
      }));

      res.json({
        source,
        checkedAt: new Date().toISOString(),
        checkedCount: normalized.length,
        missing,
      });
    } catch (err) {
      logger.error({ err }, "Lifespan audit failed");
      res.status(500).json({ error: "Lifespan audit failed" });
    }
  },
);

// ─── Product compatibility map ────────────────────────────────────────────────
// Keyed by full SKU or SKU prefix (ends with "-").
// Values are { ids: product IDs from MOCK_PRODUCTS, reason: compatibilityReason }.
const COMPATIBILITY_MAP: Record<string, { ids: number[]; reason: string }> = {
  // All filter bottles → bottle replacement cartridge + carry sleeve
  "UC-BTL-HFX-001": { ids: [22, 21], reason: "Replacement Filter" },
  "UC-BTL-TGO-002": { ids: [22, 21], reason: "Replacement Filter" },
  "UC-BTL-VDP-003": { ids: [22, 21], reason: "Replacement Filter" },
  "UC-BTL-FLX-004": { ids: [22, 21], reason: "Replacement Filter" },
  "UC-BTL-TMB-005": { ids: [22, 21], reason: "Replacement Filter" },
  "UC-BTL-GYM-006": { ids: [22, 21], reason: "Replacement Filter" },
  "UC-BTL-BRZ-008": { ids: [22, 21], reason: "Replacement Filter" },
  // Survivor Straw → straw cartridge + replacement shell
  "UC-STR-SVV-007": { ids: [26, 27], reason: "Replacement Filter" },
  // EcoSmart Elite (advanced portable filter) → bottle cartridge
  "UC-ESE-ELT-009": { ids: [22], reason: "Replacement Filter" },
  // Sweet Home faucet filter → faucet cartridge
  "UC-FCT-SWH-011": { ids: [23], reason: "Replacement Filter" },
  // Standard shower/skin filters → shower cartridge
  "UC-SHW-JAD-015": { ids: [24], reason: "Replacement Filter" },
  "UC-SHW-DFF-016": { ids: [24], reason: "Replacement Filter" },
  "UC-SHW-DCR-017": { ids: [24], reason: "Replacement Filter" },
  "UC-SKW-SHF-022": { ids: [24], reason: "Replacement Filter" },
  // Derma Flux facial faucet filter → Derma Flux cartridge
  "UC-SKW-DFS-024": { ids: [25], reason: "Replacement Filter" },
  // Replacement cartridges → matching parent filter as accessory suggestion
  "UC-RPL-BTL-010": { ids: [21], reason: "Compatible Accessory" },
  "UC-RPL-FCT-014": { ids: [11], reason: "Compatible Accessory" },
  "UC-RPL-SHW-018": { ids: [15, 17, 18], reason: "Compatible Accessory" },
  "UC-SKW-DFO-025": { ids: [19], reason: "Compatible Accessory" },
  "UC-BOG-FCS-017": { ids: [7, 27], reason: "Compatible Accessory" },
  "UC-BOG-SHL-018": { ids: [7, 26], reason: "Compatible Accessory" },
  // Bottle sleeve → any bottle is compatible; suggest cartridge
  "UC-ACC-SLV-021": { ids: [22], reason: "Compatible Accessory" },
};

// Returns the compatibilityReason for a product based on its tags/category.
function resolveCompatibilityReason(
  product: Record<string, unknown>,
  defaultReason: string
): string {
  const tags = product["tags"] as { name: string }[] | undefined;
  if (tags?.some((t) => t.name === "replacement")) return "Replacement Filter";
  const cats = product["categories"] as { name: string }[] | undefined;
  if (cats?.some((c) => c.name === CAT_ACCESS.name)) return "Compatible Accessory";
  return defaultReason;
}

router.get("/uc/products/compatibility", async (req: Request, res: Response): Promise<void> => {
  try {
    const rawSkus = req.query["skus"];
    const skus: string[] = typeof rawSkus === "string" && rawSkus.trim()
      ? rawSkus.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    // Collect compatible product IDs + their default reason from the map.
    const collected: Map<number, string> = new Map();

    for (const sku of skus) {
      const entry = COMPATIBILITY_MAP[sku];
      if (entry) {
        for (const id of entry.ids) {
          // First writer wins for reason; avoid overwriting with a weaker match.
          if (!collected.has(id)) collected.set(id, entry.reason);
        }
      }
    }

    // WooCommerce cross-sell enrichment (best-effort; silently skipped when absent).
    if (hasWCCredentials() && skus.length > 0) {
      for (const sku of skus) {
        // Look up the WC product by SKU to get its cross_sell_ids.
        const wcProducts = await wcFetchArray("/products", { sku, per_page: "1" });
        const wcp = wcProducts?.[0];
        const crossSellIds = Array.isArray(wcp?.["cross_sell_ids"])
          ? (wcp["cross_sell_ids"] as number[])
          : [];
        for (const id of crossSellIds) {
          if (!collected.has(id)) collected.set(id, "Compatible Accessory");
        }
      }
    }

    // Resolve full product objects.
    let results: Record<string, unknown>[] = [];

    if (collected.size > 0) {
      const ids = [...collected.keys()];

      if (hasWCCredentials()) {
        const include = ids.join(",");
        const wcProducts = await wcFetchArray("/products", { include, per_page: "50" });
        if (wcProducts && wcProducts.length > 0) {
          results = wcProducts.map((p) => {
            const norm = normalizeProduct(p);
            return {
              ...norm,
              compatibilityReason: resolveCompatibilityReason(
                norm,
                collected.get(Number(norm["id"])) ?? "Compatible Accessory"
              ),
            };
          });
        }
      }

      // Fall back to MOCK_PRODUCTS for any IDs not resolved from WooCommerce.
      const resolvedIds = new Set(results.map((p) => Number(p["id"])));
      for (const id of ids) {
        if (!resolvedIds.has(id)) {
          const mock = MOCK_PRODUCTS.find((p) => p["id"] === id);
          if (mock) {
            results.push({
              ...mock,
              compatibilityReason: resolveCompatibilityReason(
                mock,
                collected.get(id) ?? "Compatible Accessory"
              ),
            });
          }
        }
      }
    }

    // Best-seller fallback — return first 4 products when nothing was matched.
    if (results.length === 0) {
      let fallback: Record<string, unknown>[] = [];
      if (hasWCCredentials()) {
        const wc = await wcFetchArray("/products", { orderby: "popularity", per_page: "4" });
        if (wc && wc.length > 0) {
          fallback = wc.map(normalizeProduct);
        }
      }
      if (fallback.length === 0) {
        fallback = MOCK_PRODUCTS.slice(0, 4);
      }
      results = fallback.map((p) => ({
        ...p,
        compatibilityReason: resolveCompatibilityReason(p, "Compatible Accessory"),
      }));
    }

    // Deduplicate (by id) and cap at 8.
    const seen = new Set<number>();
    const deduped: Record<string, unknown>[] = [];
    for (const p of results) {
      const pid = Number(p["id"]);
      if (!seen.has(pid)) {
        seen.add(pid);
        deduped.push(p);
        if (deduped.length >= 8) break;
      }
    }

    // Apply product-media overlays.
    const mediaMap = await fetchProductMediaMap(deduped.map((p) => Number(p["id"])));
    res.json(
      deduped.map((p) => ({
        ...applyProductMedia(p, mediaMap.get(Number(p["id"]))),
        compatibilityReason: p["compatibilityReason"],
      }))
    );
  } catch (err) {
    logger.error({ err }, "Failed to fetch product compatibility");
    res.status(500).json({ error: "Failed to fetch product compatibility" });
  }
});

router.get("/uc/products/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params["id"]));
  try {
    let payload: Record<string, unknown> | null = null;
    if (hasWCCredentials()) {
      const product = await wcFetchOne(`/products/${id}`);
      if (product) payload = normalizeProduct(product);
    }
    if (!payload) {
      const product = MOCK_PRODUCTS.find((p) => p["id"] === id);
      if (!product) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      payload = product;
    }
    const mediaMap = await fetchProductMediaMap([id]);
    res.json(applyProductMedia(payload, mediaMap.get(id)));
  } catch {
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

// ─── Reviews ──────────────────────────────────────────────────────────────────
const REVIEW_MAX_MEDIA = 4;

/** Accepts "/objects/…" (raw objectPath), "/api/storage/objects/…",
 *  "/api/uc/product-images/…" or absolute http(s) URLs. Anything else → null. */
function normalizeMediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/objects/")) return `/api/storage${raw}`;
  if (raw.startsWith("/api/storage/objects/")) return raw;
  if (raw.startsWith("/api/uc/product-images/")) return raw;
  return null;
}

router.get("/uc/products/:id/reviews", async (req: Request, res: Response): Promise<void> => {
  const productId = parseInt(String(req.params["id"]));
  if (isNaN(productId)) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(ucReviewsTable)
      .where(eq(ucReviewsTable.productId, productId))
      .orderBy(desc(ucReviewsTable.createdAt));
    const count = rows.length;
    const average = count
      ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10
      : 0;
    const claims = verifyToken(req.headers["authorization"]);
    const uid = claims ? String(claims.id) : null;
    res.json({
      average,
      count,
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        authorName: r.authorName,
        media: r.media ?? [],
        createdAt: r.createdAt,
        mine: uid !== null && r.userId === uid,
      })),
    });
  } catch (err) {
    logger.error({ err, productId }, "Failed to load reviews");
    res.status(500).json({ error: "Failed to load reviews" });
  }
});

router.post("/uc/products/:id/reviews", async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const productId = parseInt(String(req.params["id"]));
  if (isNaN(productId)) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }

  const { rating, title, body, media } = req.body as {
    rating?: unknown; title?: unknown; body?: unknown;
    media?: { url?: unknown; type?: unknown }[];
  };

  // Reject deleted accounts — their JWT is still cryptographically valid.
  const reviewNumericId = Number(claims.id);
  if (await guardDeletedAccount(reviewNumericId, res)) return;

  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    res.status(400).json({ error: "Rating must be a whole number from 1 to 5" });
    return;
  }
  const text = typeof body === "string" ? body.trim() : "";
  if (text.length < 3) {
    res.status(400).json({ error: "Please write a few words about the product" });
    return;
  }
  if (text.length > 2000) {
    res.status(400).json({ error: "Review is too long (max 2000 characters)" });
    return;
  }

  const items: ReviewMediaItem[] = [];
  if (media !== undefined) {
    if (!Array.isArray(media) || media.length > REVIEW_MAX_MEDIA) {
      res.status(400).json({ error: `You can attach up to ${REVIEW_MAX_MEDIA} photos/videos` });
      return;
    }
    let videos = 0;
    for (const m of media) {
      const url = normalizeMediaUrl(m?.url);
      const type = m?.type === "video" ? "video" : m?.type === "photo" ? "photo" : null;
      if (!url || !type) {
        res.status(400).json({ error: "Invalid attachment" });
        return;
      }
      if (type === "video" && ++videos > 1) {
        res.status(400).json({ error: "Only one video per review" });
        return;
      }
      items.push({ url, type });
    }
  }
  const reviewMediaError = await verifyUploadedMediaItems(items);
  if (reviewMediaError) {
    res.status(400).json({ error: reviewMediaError });
    return;
  }

  const userId = String(claims.id);
  // Prefer the fresh DB name; fall back to whatever the JWT carries.
  let authorName = [claims.firstName, claims.lastName?.[0] ? `${claims.lastName[0]}.` : ""]
    .filter(Boolean).join(" ") || "Customer";
  try {
    const numericId = Number(userId);
    if (!isNaN(numericId) && numericId > 0 && numericId < 1_000_000_000) {
      const dbUser = await db.query.ucUsersTable.findFirst({ where: eq(ucUsersTable.id, numericId) });
      if (dbUser) {
        authorName = [dbUser.firstName, dbUser.lastName?.[0] ? `${dbUser.lastName[0]}.` : ""]
          .filter(Boolean).join(" ") || "Customer";
      }
    }
  } catch { /* keep JWT-derived name */ }

  try {
    const existing = await db.query.ucReviewsTable.findFirst({
      where: and(eq(ucReviewsTable.productId, productId), eq(ucReviewsTable.userId, userId)),
    });
    if (existing) {
      const [updated] = await db
        .update(ucReviewsTable)
        .set({ rating: stars, title: typeof title === "string" ? title.trim() : "", body: text, media: items, authorName })
        .where(eq(ucReviewsTable.id, existing.id))
        .returning();
      res.json({ ...updated, updated: true });
      return;
    }
    const [row] = await db
      .insert(ucReviewsTable)
      .values({
        productId,
        userId,
        authorName,
        rating: stars,
        title: typeof title === "string" ? title.trim() : "",
        body: text,
        media: items,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err, productId, userId }, "Failed to save review");
    res.status(500).json({ error: "Failed to save review" });
  }
});

// ─── Admin · product media management ─────────────────────────────────────────
function adminEmailList(): string[] {
  return (process.env["UC_ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function isAdminRequest(authHeader: string | undefined): Promise<boolean> {
  const claims = verifyToken(authHeader);
  if (!claims) return false;
  // ProjectHub team admins carry a team-session JWT with role:"admin".
  // Accept those directly — they are signed with the same SESSION_SECRET
  // and their role is set at login time by the team_users table.
  if (claims.type === "team-session" && claims.role === "admin") return true;
  // UC customer admin check — strictly DB-anchored: the bearer token must
  // resolve to a real registered user row. JWT claims alone are NEVER
  // trusted for admin — the dev login fallback can mint tokens carrying an
  // arbitrary email.
  const numericId = Number(claims.id);
  if (isNaN(numericId) || numericId <= 0 || numericId >= 1_000_000_000) return false;
  try {
    const dbUser = await db.query.ucUsersTable.findFirst({ where: eq(ucUsersTable.id, numericId) });
    if (!dbUser) return false;
    return dbUser.isAdmin || adminEmailList().includes(dbUser.email.toLowerCase());
  } catch {
    return false; // DB unavailable → fail closed
  }
}

// Attach-time verification of uploaded media ---------------------------------
const objectStorage = new ObjectStorageService();
const UPLOADED_MEDIA_PREFIX = "/api/storage/objects/";

/** Presigned PUT URLs cannot bind size or content-type, so whatever the
 *  client actually uploaded must be re-checked here, the moment an object is
 *  attached to a review / ticket / water test / product. Returns an error
 *  message, or null when every attachment checks out. Never throws. */
async function verifyUploadedMediaItems(items: ReviewMediaItem[]): Promise<string | null> {
  for (const item of items) {
    if (!item.url.startsWith(UPLOADED_MEDIA_PREFIX)) continue; // catalogue/external URL — nothing stored to verify
    const objectPath = item.url.slice("/api/storage".length); // "/objects/uploads/<id>"
    if (!objectPath.startsWith("/objects/uploads/")) return "Invalid attachment";
    try {
      const file = await objectStorage.getObjectEntityFile(objectPath);
      const [metadata] = await file.getMetadata();
      const contentType = String(metadata.contentType ?? "");
      const size = Number(metadata.size ?? 0);
      if (item.type === "photo" && !contentType.startsWith("image/")) return "Attachment is not an image";
      if (item.type === "video" && !contentType.startsWith("video/")) return "Attachment is not a video";
      const cap = item.type === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (size <= 0 || size > cap) {
        return `Attachment exceeds the ${Math.round(cap / 1024 / 1024)} MB limit`;
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return "Attachment upload not found — please re-attach it";
      logger.error({ err, url: item.url }, "Failed to verify uploaded media");
      return "Could not verify attachment — please try again";
    }
  }
  return null;
}

/** Normalize an optional array of media URLs from the client. Returns null on
 *  malformed input (wrong shape, too many, or off-whitelist URL). */
function sanitizeMediaUrls(value: unknown, max: number): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const v of value) {
    const normalized = normalizeMediaUrl(v);
    if (!normalized) return null;
    out.push(normalized);
  }
  return out;
}

router.get("/uc/admin/products/:id/media", async (req: Request, res: Response): Promise<void> => {
  if (!(await isAdminRequest(req.headers["authorization"]))) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const productId = parseInt(String(req.params["id"]));
  if (isNaN(productId)) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(ucProductMediaTable)
      .where(eq(ucProductMediaTable.productId, productId))
      .orderBy(asc(ucProductMediaTable.position), asc(ucProductMediaTable.id));
    res.json(rows);
  } catch (err) {
    logger.error({ err, productId }, "Failed to load product media");
    res.status(500).json({ error: "Failed to load product media" });
  }
});

router.post("/uc/admin/products/:id/media", async (req: Request, res: Response): Promise<void> => {
  if (!(await isAdminRequest(req.headers["authorization"]))) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const productId = parseInt(String(req.params["id"]));
  if (isNaN(productId)) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }
  const { url, type, alt, position } = req.body as {
    url?: unknown; type?: unknown; alt?: unknown; position?: unknown;
  };
  const normalized = normalizeMediaUrl(url);
  const mediaType = type === "video" ? "video" : type === "photo" ? "photo" : null;
  if (!normalized || !mediaType) {
    res.status(400).json({ error: "A valid url and type ('photo' | 'video') are required" });
    return;
  }
  const adminMediaError = await verifyUploadedMediaItems([{ url: normalized, type: mediaType }]);
  if (adminMediaError) {
    res.status(400).json({ error: adminMediaError });
    return;
  }
  try {
    const [row] = await db
      .insert(ucProductMediaTable)
      .values({
        productId,
        type: mediaType,
        url: normalized,
        alt: typeof alt === "string" ? alt : "",
        position: Number.isInteger(Number(position)) ? Number(position) : 0,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err, productId }, "Failed to add product media");
    res.status(500).json({ error: "Failed to add product media" });
  }
});

router.delete("/uc/admin/media/:mediaId", async (req: Request, res: Response): Promise<void> => {
  if (!(await isAdminRequest(req.headers["authorization"]))) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const mediaId = parseInt(String(req.params["mediaId"]));
  if (isNaN(mediaId)) {
    res.status(400).json({ error: "Invalid media id" });
    return;
  }
  try {
    const deleted = await db
      .delete(ucProductMediaTable)
      .where(eq(ucProductMediaTable.id, mediaId))
      .returning();
    if (deleted.length === 0) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, mediaId }, "Failed to delete product media");
    res.status(500).json({ error: "Failed to delete product media" });
  }
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
router.post("/uc/auth/login", authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  try {
    const wcBase = process.env["WC_BASE_URL"] || "https://www.ucfilters.com";
    const jwtRes = await fetch(`${wcBase}/wp-json/jwt-auth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, password }),
    });
    const jwtData: unknown = await jwtRes.json();
    if (
      jwtData &&
      typeof jwtData === "object" &&
      "token" in jwtData &&
      typeof (jwtData as Record<string, unknown>)["token"] === "string"
    ) {
      const d = jwtData as Record<string, unknown>;
      const displayName = (d["user_display_name"] as string | undefined) ?? "";
      const wcEmail = String(d["user_email"] ?? email).toLowerCase().trim();
      // Re-issue our own signed JWT so it can be verified server-side.
      // The original WC token (signed with the WC secret) is discarded.
      //
      // Principal id: the JWT plugin response carries no numeric user id, so
      // derive a stable per-user id from the (lowercased) email. Offset by 1e9
      // so it can NEVER collide with a uc_users serial id — DB-anchored logic
      // (admin checks, profile lookups) treats ids >= 1e9 as non-DB principals.
      // This also avoids linking Woo logins to same-email app accounts, which
      // would be an account-takeover vector if a Woo email were unverified.
      const wooPrincipalId =
        1_000_000_000 +
        parseInt(createHash("sha256").update(wcEmail).digest("hex").slice(0, 13), 16);
      const wcUser = {
        id: wooPrincipalId,
        email:     wcEmail,
        firstName: displayName.split(" ")[0] ?? "Customer",
        lastName:  displayName.split(" ").slice(1).join(" "),
      };
      res.json({ token: issueToken(wcUser), user: wcUser });
      return;
    }
  } catch { /* fall through to mock */ }

  // WooCommerce auth failed or credentials absent — try our own DB
  if (email && password) {
    try {
      const dbUser = await db.query.ucUsersTable.findFirst({
        where: eq(ucUsersTable.email, email.toLowerCase().trim()),
      });
      if (dbUser) {
        const match = await bcryptjs.compare(password, dbUser.passwordHash);
        if (!match) {
          res.status(401).json({ error: "Invalid credentials" });
          return;
        }
        const user = { id: dbUser.id, email: dbUser.email, phone: dbUser.phone, firstName: dbUser.firstName, lastName: dbUser.lastName };
        res.json({ token: issueToken(user), user });
        return;
      }
    } catch { /* DB unavailable — fall through to ephemeral session */ }

    // No DB record. Development only: allow an ephemeral demo session so the
    // app can be tried before WooCommerce credentials exist. Never in
    // production — it would let anyone mint a token for an arbitrary email.
    if (process.env["NODE_ENV"] !== "production" && password.length >= 6) {
      const name = email.split("@")[0] ?? "customer";
      const mockUser = {
        id:        Date.now(),
        email,
        phone:     "",
        firstName: name.charAt(0).toUpperCase() + name.slice(1),
        lastName:  "Customer",
      };
      res.json({ token: issueToken(mockUser), user: mockUser });
      return;
    }
  }
  res.status(401).json({ error: "Invalid credentials" });
});

router.post("/uc/auth/register", authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, phone, password, firstName, lastName, referralCode } = req.body as {
    email?: string;
    phone?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    referralCode?: string;
  };
  if (!email || !phone || !password || !firstName) {
    res.status(400).json({ error: "First name, email, phone number and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  // Basic phone sanity check — must start with + and contain 10-15 digits
  const cleanPhone = phone.replace(/\s/g, "");
  if (!/^\+\d{10,15}$/.test(cleanPhone)) {
    res.status(400).json({ error: "Enter a valid phone number in international format, e.g. +254712345678" });
    return;
  }
  try {
    // Check for duplicate email
    const existing = await db.query.ucUsersTable.findFirst({ where: eq(ucUsersTable.email, email.toLowerCase().trim()) }).catch(() => null);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    const passwordHash = await bcryptjs.hash(password, 10);
    const [dbUser] = await db.insert(ucUsersTable).values({
      email:    email.toLowerCase().trim(),
      passwordHash,
      phone:    cleanPhone,
      firstName,
      lastName: lastName ?? "",
    }).returning();
    const user = { id: dbUser!.id, email: dbUser!.email, phone: dbUser!.phone, firstName: dbUser!.firstName, lastName: dbUser!.lastName };
    // Store referral association so first-order discount can be applied later
    if (referralCode?.trim()) {
      registerReferralAtSignup(email, referralCode.trim());
    }
    res.json({ token: issueToken(user), user });
  } catch (err) {
    // Fallback: if DB is unavailable, issue a session-only token (not persisted)
    console.error("[register] DB error, issuing ephemeral token:", err);
    const user = { id: Date.now(), email, phone: cleanPhone, firstName, lastName: lastName ?? "" };
    if (referralCode?.trim()) registerReferralAtSignup(email, referralCode.trim());
    res.json({ token: issueToken(user), user });
  }
});

// ─── Customer ─────────────────────────────────────────────────────────────────
router.get("/uc/customer/profile", async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  // Try to look up the real user record from the DB
  try {
    const numericId = Number(claims.id);
    if (!isNaN(numericId) && numericId > 0 && numericId < 1_000_000_000) {
      // Looks like a real serial DB id (not a timestamp)
      const dbUser = await db.query.ucUsersTable.findFirst({ where: eq(ucUsersTable.id, numericId) });
      if (dbUser) {
        // Reject requests from deleted accounts — their JWT is still cryptographically
        // valid but the account has exercised its right to erasure.
        if (dbUser.deletedAt) {
          res.status(401).json({ error: "This account has been deleted" });
          return;
        }
        res.json({
          id: dbUser.id,
          email: dbUser.email,
          phone: dbUser.phone,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          isAdmin: dbUser.isAdmin || adminEmailList().includes(dbUser.email.toLowerCase()),
          billing:  { firstName: dbUser.firstName, lastName: dbUser.lastName, city: "Nairobi", country: "KE", phone: dbUser.phone },
          shipping: { firstName: dbUser.firstName, lastName: dbUser.lastName, city: "Nairobi", country: "KE", phone: dbUser.phone },
        });
        return;
      }
    }
  } catch { /* fall through */ }
  // Fallback: return whatever the JWT carries (for mock/legacy logins)
  res.json({
    id:        claims.id,
    email:     claims.email,
    firstName: claims.firstName ?? "",
    lastName:  claims.lastName  ?? "",
    phone:     "",
    // Fallback identities are not DB-anchored, so they can never be admin
    // (the email in the JWT is client-chosen in dev mode).
    isAdmin:   false,
    billing:   { firstName: claims.firstName ?? "", lastName: claims.lastName ?? "", city: "Nairobi", country: "KE", phone: "" },
    shipping:  { firstName: claims.firstName ?? "", lastName: claims.lastName ?? "", city: "Nairobi", country: "KE", phone: "" },
  });
});

router.patch("/uc/customer/profile", async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { firstName, lastName, phone } = req.body as {
    firstName?: string;
    lastName?:  string;
    phone?:     string;
  };

  if (firstName !== undefined && !firstName.trim()) {
    res.status(400).json({ error: "First name cannot be empty" });
    return;
  }
  if (phone !== undefined && phone !== "") {
    const cleanPhone = phone.replace(/\s/g, "");
    if (!/^\+\d{10,15}$/.test(cleanPhone)) {
      res.status(400).json({ error: "Enter a valid phone number in international format, e.g. +254712345678" });
      return;
    }
  }

  const numericId = Number(claims.id);
  if (isNaN(numericId) || numericId <= 0 || numericId >= 1_000_000_000) {
    res.status(403).json({ error: "Profile update is only available for registered accounts" });
    return;
  }

  if (await guardDeletedAccount(numericId, res)) return;

  const updates: Record<string, string> = {};
  if (firstName !== undefined) updates["firstName"] = firstName.trim();
  if (lastName  !== undefined) updates["lastName"]  = lastName.trim();
  if (phone     !== undefined) updates["phone"]     = phone.replace(/\s/g, "");

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    const [updated] = await db
      .update(ucUsersTable)
      .set(updates)
      .where(eq(ucUsersTable.id, numericId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id:        updated.id,
      email:     updated.email,
      phone:     updated.phone,
      firstName: updated.firstName,
      lastName:  updated.lastName,
    });
  } catch (err) {
    console.error("[profile patch] error:", err);
    res.status(500).json({ error: "Failed to update profile. Please try again." });
  }
});

// ─── Data export (GDPR Art. 20 / PDPA right to data portability) ─────────────
// Returns a machine-readable JSON copy of every category of personal data the
// system holds for the authenticated customer: profile, orders (with line
// items), maintenance tickets, water tests, and product enquiries. Served as a
// downloadable attachment so the Companion app can save/share the file.
router.get("/uc/customer/data-export", async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const numericId = Number(claims.id);
  if (isNaN(numericId) || numericId <= 0 || numericId >= 1_000_000_000) {
    res.status(403).json({ error: "Data export is only available for registered accounts" });
    return;
  }
  if (await guardDeletedAccount(numericId, res)) return;

  try {
    const user = await db.query.ucUsersTable.findFirst({ where: eq(ucUsersTable.id, numericId) });
    if (!user) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const userId = String(numericId);

    // Orders: WooCommerce is the authoritative order system when credentials
    // are configured — the DB tables only back the dev/offline path. Fetch the
    // customer's orders from Woo, scoped strictly to their account email.
    let wooOrders: Record<string, unknown>[] | null = null;
    if (hasWCCredentials()) {
      // Paginate through ALL matching pages — a data-portability export must
      // be complete, so we keep fetching until Woo returns a short page.
      const emailLc = user.email.toLowerCase();
      const PER_PAGE = 100;
      const MAX_PAGES = 200; // hard safety cap (20k orders)
      const collected: Record<string, unknown>[] = [];
      let complete = false;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const fetched = await wcFetchArray("/orders", {
          search:    user.email,
          per_page:  String(PER_PAGE),
          page:      String(page),
          orderby:   "date",
          order:     "desc",
        });
        if (fetched === null) {
          // Explicit failure: don't silently ship an export missing the
          // customer's authoritative order history.
          res.status(502).json({ error: "Order system temporarily unavailable — please try the export again shortly." });
          return;
        }
        collected.push(...fetched.filter(o => {
          const billing = o["billing"] as Record<string, unknown> | undefined;
          return String(billing?.["email"] ?? "").toLowerCase() === emailLc;
        }));
        if (fetched.length < PER_PAGE) { complete = true; break; } // last page reached
      }
      if (!complete) {
        // Never silently ship a truncated order history — a portability
        // export must be complete or fail explicitly.
        res.status(502).json({ error: "Order history too large to export in one pass — please contact support." });
        return;
      }
      wooOrders = collected;
    }

    const [orders, tickets, waterTests, enquiries, reviews, notifPrefRows, pushTokenRows] = await Promise.all([
      db.select().from(ucOrdersTable)
        .where(eq(ucOrdersTable.userId, userId))
        .orderBy(desc(ucOrdersTable.dateCreated)),
      db.select().from(ucTicketsTable)
        .where(eq(ucTicketsTable.userId, userId))
        .orderBy(desc(ucTicketsTable.createdAt)),
      db.select().from(ucWaterTestsTable)
        .where(eq(ucWaterTestsTable.userId, userId))
        .orderBy(desc(ucWaterTestsTable.createdAt)),
      db.select().from(ucEnquiriesTable)
        .where(eq(ucEnquiriesTable.userId, userId))
        .orderBy(desc(ucEnquiriesTable.createdAt)),
      db.select().from(ucReviewsTable)
        .where(eq(ucReviewsTable.userId, userId))
        .orderBy(desc(ucReviewsTable.createdAt)),
      db.select().from(ucNotifPrefsTable)
        .where(eq(ucNotifPrefsTable.userId, userId)),
      db.select().from(ucPushTokensTable)
        .where(eq(ucPushTokensTable.userId, userId)),
    ]);

    const orderIds = orders.map(o => o.id);
    const items = orderIds.length > 0
      ? await db.select().from(ucOrderItemsTable).where(inArray(ucOrderItemsTable.orderId, orderIds))
      : [];
    const itemsByOrder = items.reduce<Record<number, typeof items>>((acc, item) => {
      (acc[item.orderId] ??= []).push(item);
      return acc;
    }, {});

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      format:     "Ultra Clear customer data export v1 (GDPR Art. 20 / PDPA data portability)",
      profile: {
        id:        user.id,
        email:     user.email,
        firstName: user.firstName,
        lastName:  user.lastName,
        phone:     user.phone,
        createdAt: user.createdAt,
      },
      orders: wooOrders !== null
        ? wooOrders.map(normalizeOrder)
        : orders.map(o => ({
            id:              o.id,
            status:          o.status,
            dateCreated:     o.dateCreated,
            total:           o.total,
            currency:        o.currency,
            paymentMethod:   o.paymentMethod,
            shippingAddress: o.shippingAddress ?? {},
            promoCode:       o.promoCode ?? "",
            lineItems:       (itemsByOrder[o.id] ?? []).map(i => ({
              productId: i.productId,
              name:      i.name,
              quantity:  i.quantity,
              total:     i.total,
            })),
          })),
      tickets: tickets.map(t => ({
        id:                   t.id,
        productModel:         t.productModel,
        issueDescription:     t.issueDescription,
        preferredContactTime: t.preferredContactTime,
        photos:               t.photos ?? [],
        videos:               t.videos ?? [],
        status:               t.status,
        createdAt:            t.createdAt,
      })),
      waterTests: waterTests.map(w => ({
        id:          w.id,
        name:        w.name,
        address:     w.address,
        phone:       w.phone,
        waterSource: w.waterSource,
        concerns:    w.concerns,
        photos:      w.photos ?? [],
        videos:      w.videos ?? [],
        status:      w.status,
        createdAt:   w.createdAt,
      })),
      reviews: reviews.map(r => ({
        id:         r.id,
        productId:  r.productId,
        authorName: r.authorName,
        rating:     r.rating,
        title:      r.title,
        body:       r.body,
        media:      r.media ?? [],
        createdAt:  r.createdAt,
      })),
      notificationPreferences: notifPrefRows.map(p => ({
        optOutOrderUpdates: p.optOutOrders,
        updatedAt:          p.updatedAt,
      })),
      // Push registration metadata. The raw Expo push token is the user's own
      // device credential — included since this is their personal data export.
      pushRegistrations: pushTokenRows.map(t => ({
        pushToken:          t.pushToken,
        optOutOrderUpdates: t.optOutOrders,
        updatedAt:          t.updatedAt,
      })),
      enquiries: enquiries.map(e => ({
        id:          e.id,
        productId:   e.productId,
        productName: e.productName,
        name:        e.name,
        email:       e.email,
        phone:       e.phone,
        message:     e.message,
        createdAt:   e.createdAt,
      })),
    };

    const dateStamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ultra-clear-data-export-${dateStamp}.json"`);
    res.send(JSON.stringify(exportPayload, null, 2));
  } catch (err) {
    logger.error({ err, userId: numericId }, "Failed to generate customer data export");
    res.status(500).json({ error: "Failed to generate your data export. Please try again." });
  }
});

// ─── Delete account (GDPR / PDPA right to erasure) ───────────────────────────
// Anonymises all PII in place rather than hard-deleting rows so that order
// history and ticket records remain intact for the team (foreign-key integrity
// and business audit trail). Linked personal fields are replaced with the
// "[deleted customer]" sentinel so the team can see a record existed without
// any personal data being visible.
//
// Full erasure inventory:
//   uc_users        — email, passwordHash, firstName, lastName, phone
//   uc_orders       — shippingAddress (customer's delivery/contact info)
//   uc_enquiries    — name, email, phone, message
//   uc_tickets      — issueDescription, photos[], videos[]
//   uc_water_tests  — name, phone, address, concerns, photos[], videos[]
//   uc_push_tokens  — hard-deleted (token itself is PII)
//   Object storage  — all media blobs attached to tickets and water tests
//   JSONL backups   — tickets.jsonl / water-tests.jsonl entries scrubbed by ID
//   In-memory stores — fallback arrays cleared of this user's entries

/** Check whether the uc_users row for numericId has a non-null deleted_at.
 *  Sends an appropriate HTTP error response and returns true when the route
 *  should abort immediately.  Fails CLOSED: when the DB is unavailable it
 *  returns 503 rather than passing the request through, so an erased identity
 *  can never be reactivated by a transient outage. */
async function guardDeletedAccount(numericId: number, res: Response): Promise<boolean> {
  // Non-DB-anchored identities (anonymous, legacy timestamp IDs) are not in
  // the deleted-account table — skip the check entirely.
  if (isNaN(numericId) || numericId <= 0 || numericId >= 1_000_000_000) return false;
  try {
    const result = await pool.query<{ deleted_at: string | null }>(
      "SELECT deleted_at FROM uc_users WHERE id = $1 LIMIT 1",
      [numericId]
    );
    if (result.rows[0]?.deleted_at) {
      res.status(401).json({ error: "This account has been deleted" });
      return true;
    }
    return false;
  } catch {
    // DB unavailable — fail closed to prevent erased identities from slipping through.
    res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
    return true;
  }
}

/** Best-effort delete a single media blob from object storage. Silently ignored if
 *  the URL doesn't point to an internal upload or if the file no longer exists. */
async function deleteStorageBlob(url: string): Promise<void> {
  // Only internal uploads have the /api/storage/objects/ prefix
  if (!url.startsWith(UPLOADED_MEDIA_PREFIX)) return;
  const objectPath = url.slice("/api/storage".length); // "/objects/uploads/<uuid>"
  if (!objectPath.startsWith("/objects/uploads/")) return;
  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    await file.delete();
  } catch {
    // ObjectNotFoundError or any other failure — already gone or inaccessible, skip
  }
}

/** Overwrite entries matching `predicate` in a JSONL file with the result of
 *  `scrub(line)`. Writes atomically via a temp file; silently skips on any I/O error. */
async function scrubJsonlFile(
  filename: string,
  predicate: (rec: Record<string, unknown>) => boolean,
  scrub: (rec: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const filePath = join(UC_DATA_DIR, filename);
  const tmpPath  = `${filePath}.tmp`;
  try {
    const raw    = await readFile(filePath, "utf8").catch(() => "");
    const lines  = raw.split("\n");
    const output = lines.map(line => {
      if (!line.trim()) return line;
      try {
        const rec = JSON.parse(line) as Record<string, unknown>;
        return predicate(rec) ? JSON.stringify(scrub(rec)) : line;
      } catch {
        return line; // malformed line — leave unchanged
      }
    });
    await writeFile(tmpPath, output.join("\n"), "utf8");
    await rename(tmpPath, filePath);
  } catch (err) {
    logger.warn({ err, filename }, "JSONL scrub failed — continuing deletion");
  }
}

router.delete("/uc/customer", async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  if (!claims) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const numericId = Number(claims.id);
  if (isNaN(numericId) || numericId <= 0 || numericId >= 1_000_000_000) {
    res.status(403).json({ error: "Account deletion is only available for registered accounts" });
    return;
  }

  try {
    // 1. Verify the user exists
    const existing = await db.query.ucUsersTable.findFirst({
      where: eq(ucUsersTable.id, numericId),
    });
    if (!existing) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    // Idempotency: if the account was already anonymised (deletedAt set), a
    // duplicate deletion request (network retry / race before logout) succeeds
    // with 200 instead of re-running the redaction pipeline or returning 404.
    if (existing.deletedAt) {
      res.json({ ok: true, alreadyDeleted: true, message: "Account already deleted" });
      return;
    }

    // Guard: admin accounts cannot be self-deleted through the customer route.
    // Checks both the DB flag AND the UC_ADMIN_EMAILS env list — identical to
    // how isAdminRequest() works — so environment-designated admins are also
    // protected regardless of whether their DB is_admin flag is set.
    if (existing.isAdmin || adminEmailList().includes(existing.email.toLowerCase())) {
      res.status(403).json({ error: "Admin accounts cannot be deleted through the customer deletion flow. Contact the team to remove your account." });
      return;
    }

    const DELETED = "[deleted customer]";
    const userId  = String(numericId);
    // Capture pre-deletion email for enquiry-fallback scrubbing (those records
    // have no userId, so we must match by the email they were submitted with).
    const preDeletionEmail = existing.email;

    // 2. Collect media URLs from tickets, water-tests, and reviews BEFORE
    //    redacting, so we can delete blobs from object storage.
    const [ticketRows, waterTestRows, reviewRows] = await Promise.all([
      db.select({ id: ucTicketsTable.id, photos: ucTicketsTable.photos, videos: ucTicketsTable.videos })
        .from(ucTicketsTable).where(eq(ucTicketsTable.userId, userId)),
      db.select({ id: ucWaterTestsTable.id, photos: ucWaterTestsTable.photos, videos: ucWaterTestsTable.videos })
        .from(ucWaterTestsTable).where(eq(ucWaterTestsTable.userId, userId)),
      db.select({ id: ucReviewsTable.id, media: ucReviewsTable.media })
        .from(ucReviewsTable).where(eq(ucReviewsTable.userId, userId)),
    ]);

    const ticketIds    = ticketRows.map(t => t.id);
    const waterTestIds = waterTestRows.map(w => w.id);

    // Collect linked order IDs for notification-log scrubbing
    const orderRows = await db
      .select({ id: ucOrdersTable.id })
      .from(ucOrdersTable)
      .where(eq(ucOrdersTable.userId, userId));
    const orderIds = orderRows.map(o => o.id);

    const allMediaUrls: string[] = [
      ...ticketRows.flatMap(t => [...(t.photos ?? []), ...(t.videos ?? [])]),
      ...waterTestRows.flatMap(w => [...(w.photos ?? []), ...(w.videos ?? [])]),
      ...reviewRows.flatMap(r => (r.media ?? []).map((m: ReviewMediaItem) => m.url)),
    ];

    // 3. Delete object-storage blobs (best-effort, in parallel)
    await Promise.allSettled(allMediaUrls.map(deleteStorageBlob));

    // 4. Anonymise the user row — keep id, createdAt for audit trail.
    //    isAdmin is cleared so any still-valid bearer tokens lose DB-level privilege.
    //    deletedAt is set so all DB-anchored customer routes reject further requests
    //    with this token (token revocation without a token blacklist).
    await db
      .update(ucUsersTable)
      .set({
        email:        `deleted-${numericId}@deleted.invalid`,
        passwordHash: await bcryptjs.hash(Math.random().toString(36), 10),
        firstName:    DELETED,
        lastName:     "",
        phone:        "",
        isAdmin:      false,
        deletedAt:    new Date(),
      })
      .where(eq(ucUsersTable.id, numericId));

    // 5. Redact personal fields on linked orders (shipping address carries name/phone)
    await db
      .update(ucOrdersTable)
      .set({ shippingAddress: { name: DELETED, address: "", city: "", country: "" } })
      .where(eq(ucOrdersTable.userId, userId));

    // 6. Redact ALL personal fields on enquiries (including free-text message)
    await db
      .update(ucEnquiriesTable)
      .set({ name: DELETED, email: DELETED, phone: "", message: DELETED })
      .where(eq(ucEnquiriesTable.userId, userId));

    // 7. Redact ALL personal fields on maintenance tickets (free text + media refs)
    await db
      .update(ucTicketsTable)
      .set({ issueDescription: DELETED, photos: [], videos: [] })
      .where(eq(ucTicketsTable.userId, userId));

    // 8. Redact ALL personal fields on water tests (free text + media refs)
    await db
      .update(ucWaterTestsTable)
      .set({ name: DELETED, phone: "", address: "", concerns: "", photos: [], videos: [] })
      .where(eq(ucWaterTestsTable.userId, userId));

    // 9. Redact public review content (authorName + free text + media refs).
    //    Reviews are publicly visible, so redaction is mandatory.
    await db
      .update(ucReviewsTable)
      .set({ authorName: DELETED, title: "", body: DELETED, media: [] })
      .where(eq(ucReviewsTable.userId, userId));

    // 10. Redact notification-log rows whose recipient/body carry PII.
    //     Redact recipient (email/phone) and messageBody for every log entry
    //     linked to this user's orders, tickets, or water-test IDs.
    const notifConditions = [
      ...(orderIds.length > 0    ? [inArray(ucNotificationLogTable.orderId,  orderIds)]   : []),
      ...(ticketIds.length > 0   ? [inArray(ucNotificationLogTable.ticketId,  ticketIds)]  : []),
      ...(waterTestIds.length > 0 ? [inArray(ucNotificationLogTable.testId,   waterTestIds)] : []),
    ];
    if (notifConditions.length > 0) {
      await db
        .update(ucNotificationLogTable)
        .set({ recipient: DELETED, messageBody: "" })
        .where(or(...notifConditions));
    }
    // Also redact by recipient = customer email/phone (covers SMS logs and any
    // direct sendViaResend call where the customer's contact info IS the recipient).
    const recipientConditions = [
      ...(preDeletionEmail ? [eq(ucNotificationLogTable.recipient, preDeletionEmail)] : []),
      ...(existing.phone   ? [eq(ucNotificationLogTable.recipient, existing.phone)]  : []),
    ];
    if (recipientConditions.length > 0) {
      await db
        .update(ucNotificationLogTable)
        .set({ recipient: DELETED, messageBody: "" })
        .where(or(...recipientConditions));
    }
    // Enquiry/return-request emails go to the team mailbox (info@ucfilters.com /
    // support@ucfilters.co.ke), so the recipient column is NOT the customer's
    // address.  The customer's name, email, phone, and message appear in
    // messageBody (both Resend and SendGrid/SMTP fallback paths log the full
    // plain-text body).  Use a content search to find and scrub those rows.
    if (preDeletionEmail) {
      await pool.query(
        "UPDATE uc_notification_log SET recipient = $1, message_body = '' WHERE message_body LIKE $2",
        [DELETED, `%${preDeletionEmail}%`]
      );
    }
    if (existing.phone) {
      await pool.query(
        "UPDATE uc_notification_log SET recipient = $1, message_body = '' WHERE message_body LIKE $2",
        [DELETED, `%${existing.phone}%`]
      );
    }

    // 11. Redact uc_return_requests (raw SQL — table predates Drizzle schema)
    await pool.query(
      "UPDATE uc_return_requests SET details = $1 WHERE user_id = $2",
      [DELETED, numericId]
    );

    // 12. Redact M-Pesa STK initiations — phone is the only PII stored.
    //     The record is retained for payment audit; only the phone is erased.
    if (existing.phone) {
      await db
        .update(mpesaStkInitiationsTable)
        .set({ phone: "" })
        .where(eq(mpesaStkInitiationsTable.phone, existing.phone));
    }

    // 13. Hard-delete push tokens (token string is PII) and notification prefs.
    //     uc_notif_prefs contains the stable user ID; deleting the row removes
    //     the linkage (no personal data beyond the ID itself).
    await db
      .delete(ucPushTokensTable)
      .where(eq(ucPushTokensTable.userId, userId));
    await db
      .delete(ucNotifPrefsTable)
      .where(eq(ucNotifPrefsTable.userId, userId));

    // 13. Scrub JSONL backups.
    //     tickets.jsonl  — matched by userId (always written alongside userId)
    //     water-tests.jsonl — matched by water-test ID (from DB) OR by userId
    //       for entries written after this fix, which now include a userId field.
    await Promise.allSettled([
      scrubJsonlFile("tickets.jsonl",
        rec => rec["userId"] === userId,
        rec => ({ ...rec, userId: "", issueDescription: DELETED, photos: [], videos: [] }),
      ),
      scrubJsonlFile("water-tests.jsonl",
        rec => waterTestIds.includes(String(rec["id"])) || rec["userId"] === userId,
        rec => ({ ...rec, userId: "", name: DELETED, phone: "", email: null, address: "", concerns: "", photos: [], videos: [] }),
      ),
    ]);

    // 14. Scrub in-memory fallback stores (best-effort mutation in place)
    for (const o of orderStoreFallback) {
      const r = o as Record<string, unknown>;
      if (r["userId"] === userId) {
        r["shippingAddress"] = { name: DELETED, address: "", city: "", country: "" };
      }
    }
    for (const t of ticketStoreFallback) {
      const r = t as Record<string, unknown>;
      if (r["userId"] === userId) {
        r["issueDescription"] = DELETED;
        r["photos"] = [];
        r["videos"] = [];
      }
    }
    for (const w of waterTestStoreFallback) {
      const r = w as Record<string, unknown>;
      if (r["userId"] === userId || waterTestIds.includes(String(r["id"]))) {
        r["name"]     = DELETED;
        r["phone"]    = "";
        r["address"]  = "";
        r["concerns"] = "";
        r["photos"]   = [];
        r["videos"]   = [];
      }
    }
    // Enquiry fallback: no userId stored, match by the pre-deletion email address
    for (const e of enquiryStoreFallback) {
      const r = e as Record<string, unknown>;
      if (r["email"] === preDeletionEmail) {
        r["name"]    = DELETED;
        r["email"]   = DELETED;
        r["phone"]   = "";
        r["message"] = DELETED;
      }
    }

    logger.info({ userId: numericId }, "Customer account anonymised on deletion request");

    // 15. Notify the team — best-effort, never blocks the deletion response.
    //     No PII is included: only the numeric user ID and the UTC timestamp.
    const deletedAt = new Date().toUTCString();
    sendViaResend({
      from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
      to:   "info@ucfilters.com",
      subject: `Account deleted — user #${numericId}`,
      text: [
        "A customer has exercised their right to erasure.",
        "",
        `User ID   : ${numericId}`,
        `Deleted at: ${deletedAt} (UTC)`,
        "",
        "All personal data has been anonymised. No action is required unless",
        "a dispute or order investigation is in progress for this account.",
      ].join("\n"),
      html: [
        "<p>A customer has exercised their right to erasure.</p>",
        "<ul>",
        `<li><strong>User ID:</strong> ${numericId}</li>`,
        `<li><strong>Deleted at:</strong> ${deletedAt} (UTC)</li>`,
        "</ul>",
        "<p>All personal data has been anonymised. No action is required unless",
        "a dispute or order investigation is in progress for this account.</p>",
      ].join("\n"),
      meta: { template: "account_deleted" },
    }).catch(err => logger.warn({ err, userId: numericId }, "Account-deletion team notification not sent"));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId: numericId }, "Failed to delete customer account");
    res.status(500).json({ error: "Failed to delete account. Please try again or contact support." });
  }
});

// ─── Payment verification helpers (server-side; called before order creation) ─
async function verifyPaymentOnServer(
  method: string,
  reference: string
): Promise<{ ok: boolean; reason?: string; retryable?: boolean }> {
  // COD requires no pre-payment
  if (method === "cod") return { ok: true };

  if (!reference) return { ok: false, reason: "No payment reference provided" };

  // ── M-Pesa ──
  if (method === "mpesa") {
    const shortcode = process.env["MPESA_SHORTCODE"];
    const passkey = process.env["MPESA_PASSKEY"];
    const key = process.env["MPESA_CONSUMER_KEY"];
    const secret = process.env["MPESA_CONSUMER_SECRET"];
    if (!key || !secret || !shortcode || !passkey) {
      // Mock mode: accept any reference
      return { ok: true };
    }
    try {
      const creds = Buffer.from(`${key}:${secret}`).toString("base64");
      const env = process.env["MPESA_ENV"] === "production" ? "api" : "sandbox";
      const tokenRes = await fetch(
        `https://${env}.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials`,
        { headers: { Authorization: `Basic ${creds}` } }
      );
      const tokenData = (await tokenRes.json()) as { access_token?: string };
      const token = tokenData.access_token;
      if (!token) return { ok: false, reason: "Failed to get M-Pesa token" };
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
      const qRes = await fetch(`https://${env}.safaricom.co.ke/mpesa/stkpushquery/v1/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ BusinessShortCode: shortcode, Password: password, Timestamp: timestamp, CheckoutRequestID: reference }),
      });
      const qData = (await qRes.json()) as Record<string, string>;
      const ok = qData["ResultCode"] === "0";
      return ok ? { ok: true } : { ok: false, reason: qData["ResultDesc"] ?? "M-Pesa not confirmed" };
    } catch {
      return { ok: false, reason: "M-Pesa verification request failed" };
    }
  }

  // ── Stripe ──
  if (method === "stripe") {
    const stripeKey = process.env["STRIPE_SECRET_KEY"];
    if (!stripeKey) {
      // Mock mode: accept any session ID
      return { ok: true };
    }
    try {
      const StripeSDK = await import("stripe");
      const stripe = new StripeSDK.default(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(reference);
      const ok = session.payment_status === "paid";
      return ok ? { ok: true } : { ok: false, reason: `Stripe session status: ${session.payment_status}` };
    } catch (e: unknown) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  // ── Paystack ──
  if (method === "paystack") {
    const secretKey = process.env["PAYSTACK_SECRET_KEY"];
    if (!secretKey) {
      // Mock mode: accept any reference
      return { ok: true };
    }
    try {
      const vRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      // Treat upstream 5xx / 429 as a transient outage — Paystack blips commonly
      // manifest as a non-2xx HTTP response rather than a thrown exception.
      if (!vRes.ok) {
        const isTransient = vRes.status >= 500 || vRes.status === 429;
        return {
          ok: false,
          reason: "Paystack verification request failed",
          ...(isTransient ? { retryable: true } : {}),
        };
      }
      const vData = (await vRes.json()) as { status: boolean; data?: { status: string } };
      const ok = vData.status && vData.data?.status === "success";
      return ok ? { ok: true } : { ok: false, reason: `Paystack status: ${vData.data?.status ?? "unknown"}` };
    } catch {
      // Network or timeout — transient; caller should offer a retry path.
      return { ok: false, reason: "Paystack verification request failed", retryable: true };
    }
  }

  return { ok: false, reason: `Unknown payment method: ${method}` };
}

// ─── Orders ───────────────────────────────────────────────────────────────────
router.get("/uc/orders", async (req: Request, res: Response): Promise<void> => {
  const claims = verifyToken(req.headers["authorization"]);
  const userId = userIdFromBearer(req.headers["authorization"]);
  try {
    if (hasWCCredentials()) {
      // Woo is store-wide — orders MUST be scoped to the authenticated user's
      // email. Woo's `search` narrows the fetch; the strict billing-email
      // filter below is the authorization boundary (search is fuzzy).
      const emailLc = String(claims?.email ?? "").trim().toLowerCase();
      if (!emailLc) {
        // No verified identity — never expose store-wide orders.
        res.json([]);
        return;
      }
      const orders = await wcFetchArray("/orders", {
        search: emailLc, per_page: "20", orderby: "date", order: "desc",
      });
      if (orders) {
        res.json(orders
          .filter(o => {
            const billing = o["billing"] as Record<string, unknown> | undefined;
            return String(billing?.["email"] ?? "").toLowerCase() === emailLc;
          })
          .map(normalizeOrder));
        return;
      }
    }
    // DB path: fetch this user's orders with their line items
    const orders = await db.select().from(ucOrdersTable)
      .where(eq(ucOrdersTable.userId, userId))
      .orderBy(desc(ucOrdersTable.dateCreated));
    if (orders.length === 0) {
      res.json([]);
      return;
    }
    const orderIds = orders.map(o => o.id);
    const items = await db.select().from(ucOrderItemsTable)
      .where(inArray(ucOrderItemsTable.orderId, orderIds));
    const itemsByOrder = items.reduce<Record<number, typeof items>>((acc, item) => {
      (acc[item.orderId] ??= []).push(item);
      return acc;
    }, {});
    res.json(orders.map(o => ({
      id:              o.id,
      status:          o.status,
      dateCreated:     o.dateCreated,
      total:           o.total,
      currency:        o.currency,
      paymentMethod:   o.paymentMethod,
      shippingAddress: o.shippingAddress ?? {},
      discountPercent: o.discountPercent,
      discountAmount:  o.discountAmount,
      promoCode:       o.promoCode ?? "",
      webhookRecovery: o.webhookRecovery ?? false,
      lineItems:       (itemsByOrder[o.id] ?? []).map(i => ({
        productId: i.productId,
        name:      i.name,
        quantity:  i.quantity,
        total:     i.total,
      })),
    })));
  } catch {
    res.json(orderStoreFallback.filter(o => (o as Record<string,unknown>)["userId"] === userId));
  }
});

// ─── Return Requests ──────────────────────────────────────────────────────────
const RETURN_WINDOW_DAYS = 30;
const RETURN_ELIGIBLE_STATUSES = ["completed", "shipped"];
const RETURN_REASONS = [
  "Defective or faulty product",
  "Wrong item delivered",
  "Product not as described",
  "Changed my mind",
];

/** GET /uc/orders/:orderId/return-request — fetch existing return request for this order/user */
router.get("/uc/orders/:orderId/return-request", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFromBearer(req.headers["authorization"]);
  const orderId = parseInt(String(req.params["orderId"] ?? ""), 10);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid order ID." }); return; }
  try {
    const result = await pool.query(
      "SELECT id, reason, details, status, created_at FROM uc_return_requests WHERE order_id = $1 AND user_id = $2 LIMIT 1",
      [orderId, userId]
    );
    if (result.rows.length === 0) { res.json({ request: null }); return; }
    const r = result.rows[0] as { id: number; reason: string; details: string; status: string; created_at: string };
    res.json({ request: { id: r.id, reason: r.reason, details: r.details, status: r.status, createdAt: r.created_at } });
  } catch (err) {
    logger.error({ err }, "Return request fetch error");
    res.status(500).json({ error: "Failed to fetch return request." });
  }
});

/** POST /uc/orders/:orderId/return-request — submit a return request */
router.post("/uc/orders/:orderId/return-request", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFromBearer(req.headers["authorization"]);
  const retNumericId = Number(userId);
  if (await guardDeletedAccount(retNumericId, res)) return;
  const orderId = parseInt(String(req.params["orderId"] ?? ""), 10);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid order ID." }); return; }

  const { reason, details } = req.body ?? {};
  if (!reason || typeof reason !== "string") { res.status(400).json({ error: "reason is required." }); return; }
  if (!RETURN_REASONS.includes(reason)) { res.status(400).json({ error: "Invalid reason. Please select a valid return reason." }); return; }

  try {
    const [order] = await db.select().from(ucOrdersTable)
      .where(and(eq(ucOrdersTable.id, orderId), eq(ucOrdersTable.userId, userId)))
      .limit(1);
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }

    if (!RETURN_ELIGIBLE_STATUSES.includes(order.status)) {
      res.status(422).json({ error: "Returns can only be requested for delivered or shipped orders. If you have a concern about a pending order, please contact our support team." }); return;
    }

    const daysSince = (Date.now() - new Date(order.dateCreated).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > RETURN_WINDOW_DAYS) {
      res.status(422).json({ error: `Our return window is ${RETURN_WINDOW_DAYS} days from the order date. This order is outside that window — but please reach out to support@ucfilters.co.ke or call 0717774049. Our team reviews every case personally.` }); return;
    }

    const existing = await pool.query(
      "SELECT id FROM uc_return_requests WHERE order_id = $1 AND user_id = $2 LIMIT 1",
      [orderId, userId]
    );
    if (existing.rows.length > 0) { res.status(409).json({ error: "A return request has already been submitted for this order." }); return; }

    const insert = await pool.query(
      "INSERT INTO uc_return_requests (order_id, user_id, reason, details) VALUES ($1, $2, $3, $4) RETURNING id, status, created_at",
      [orderId, userId, reason, (details ?? "").toString().trim()]
    );
    const row = insert.rows[0] as { id: number; status: string; created_at: string };

    // Notify the support team by email (non-blocking)
    const numericUserId = Number(userId);
    const [customer] = !isNaN(numericUserId)
      ? await db.select({ email: ucUsersTable.email })
          .from(ucUsersTable).where(eq(ucUsersTable.id, numericUserId)).limit(1)
      : [undefined];
    const detailsText = (details ?? "").toString().trim();
    sendViaResend({
      from: "Ultra-Clear Returns <noreply@contacts.ucfilters.com>",
      to: "support@ucfilters.co.ke",
      subject: `Return Request #${row.id} — Order #${orderId}`,
      text: [
        `A new return request has been submitted.`,
        `Request ID : ${row.id}`,
        `Order ID   : ${orderId}`,
        `Customer   : ${customer?.email ?? "unknown"}`,
        `Reason     : ${reason}`,
        detailsText ? `Details    : ${detailsText}` : "",
        ``,
        `Please review and contact the customer within 2 business days.`,
      ].filter(Boolean).join("\n"),
      html: `<p><strong>New Return Request #${row.id}</strong></p><ul><li><strong>Order:</strong> #${orderId}</li><li><strong>Customer:</strong> ${customer?.email ?? "unknown"}</li><li><strong>Reason:</strong> ${reason}</li>${detailsText ? `<li><strong>Details:</strong> ${detailsText}</li>` : ""}</ul><p>Please review and contact the customer within 2 business days.</p>`,
    }).catch(err => logger.warn({ err }, "Return request team email not sent"));

    res.status(201).json({
      ok: true,
      requestId: row.id,
      status: row.status,
      message: "Your return request has been received. Our team will be in touch within 2 business days. You can also reach us at support@ucfilters.co.ke or call 0717774049.",
    });
  } catch (err) {
    logger.error({ err }, "Return request submission error");
    res.status(500).json({ error: "Failed to submit return request. Please try again or contact support@ucfilters.co.ke." });
  }
});

// ─── Admin: all orders (team view) ───────────────────────────────────────────
// Returns every order in the database regardless of userId.
// Requires admin auth (DB-anchored: caller must be a registered admin user).
router.get("/uc/admin/orders", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) {
    // Unauthenticated or non-admin callers get a 403; recovery orders must
    // not be readable by arbitrary users.
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const dateRange = parseDateRange(req, res);
  if (!dateRange) return;

  try {
    const statusFilter = typeof req.query["status"] === "string" && req.query["status"].trim()
      ? req.query["status"].trim()
      : null;

    const orders = await db
      .select()
      .from(ucOrdersTable)
      .where(and(
        statusFilter ? eq(ucOrdersTable.status, statusFilter) : undefined,
        dateRange.from ? sql`${ucOrdersTable.dateCreated}::date >= ${dateRange.from}::date` : undefined,
        dateRange.to   ? sql`${ucOrdersTable.dateCreated}::date <= ${dateRange.to}::date`   : undefined,
      ))
      .orderBy(desc(ucOrdersTable.dateCreated));

    if (orders.length === 0) {
      res.json([]);
      return;
    }

    const orderIds = orders.map(o => o.id);
    const items = await db.select().from(ucOrderItemsTable)
      .where(inArray(ucOrderItemsTable.orderId, orderIds));
    const itemsByOrder = items.reduce<Record<number, typeof items>>((acc, item) => {
      (acc[item.orderId] ??= []).push(item);
      return acc;
    }, {});

    res.json(orders.map(o => ({
      id:               o.id,
      userId:           o.userId,
      status:           o.status,
      dateCreated:      o.dateCreated,
      total:            o.total,
      currency:         o.currency,
      paymentMethod:    o.paymentMethod,
      paymentReference: o.paymentReference ?? "",
      promoCode:        o.promoCode ?? "",
      discountPercent:  o.discountPercent,
      discountAmount:   o.discountAmount,
      shippingAddress:  o.shippingAddress ?? {},
      // True only for orders inserted by the webhook recovery path —
      // persisted at insert time, never derived from userId heuristics.
      webhookRecovery:  o.webhookRecovery ?? false,
      lineItems: (itemsByOrder[o.id] ?? []).map(i => ({
        productId: i.productId,
        name:      i.name,
        quantity:  i.quantity,
        total:     i.total,
      })),
    })));
  } catch (err) {
    logger.error({ err }, "Failed to load admin orders");
    res.status(500).json({ error: "Failed to load orders" });
  }
});

// ─── Admin order actions (admin-only mutations) ──────────────────────────────
// Statuses the team may set directly. "refunded" is deliberately excluded —
// it is only reachable through the refund endpoint so a real Paystack refund
// can never be skipped by a plain status change.
const ADMIN_SETTABLE_STATUSES = new Set([
  "pending", "processing", "paid", "declined", "completed", "cancelled",
]);

// PATCH /api/uc/admin/orders/:id/status — categorize an order (paid, declined, …)
router.patch("/uc/admin/orders/:id/status", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) { res.status(403).json({ error: "Admin access required" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid order id" }); return; }

  const status = typeof req.body?.status === "string" ? req.body.status.trim().toLowerCase() : "";
  if (!ADMIN_SETTABLE_STATUSES.has(status)) {
    res.status(400).json({ error: `Invalid status. Allowed: ${[...ADMIN_SETTABLE_STATUSES].join(", ")}` });
    return;
  }

  try {
    const [order] = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.id, id)).limit(1);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (order.status === "refunded") {
      res.status(409).json({ error: "Refunded orders cannot be re-categorized" });
      return;
    }
    await db.update(ucOrdersTable).set({ status }).where(eq(ucOrdersTable.id, id));
    logger.info({ orderId: id, from: order.status, to: status }, "Admin order status change");
    res.json({ ok: true, id, status });
  } catch (err) {
    logger.error({ err, orderId: id }, "Failed to update order status");
    res.status(500).json({ error: "Failed to update order status" });
  }
});

// POST /api/uc/admin/orders/:id/refund — refund an order.
// Paystack payments trigger a REAL refund through the Paystack API before the
// order is marked refunded; if Paystack rejects the refund the order status is
// left untouched. M-Pesa/COD orders are marked refunded for record-keeping
// only (M-Pesa reversals are handled manually by the team).
router.post("/uc/admin/orders/:id/refund", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) { res.status(403).json({ error: "Admin access required" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid order id" }); return; }

  try {
    const [order] = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.id, id)).limit(1);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (order.status === "refunded") { res.status(409).json({ error: "Order is already refunded" }); return; }

    let paystackRefunded = false;
    if (order.paymentMethod === "paystack" && order.paymentReference) {
      const secretKey = process.env["PAYSTACK_SECRET_KEY"];
      if (!secretKey) {
        res.status(500).json({ error: "PAYSTACK_SECRET_KEY is not configured — cannot send a real refund" });
        return;
      }
      const psRes = await fetch("https://api.paystack.co/refund", {
        method:  "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ transaction: order.paymentReference }),
      });
      const data = (await psRes.json().catch(() => null)) as { status?: boolean; message?: string } | null;
      if (!psRes.ok || !data?.status) {
        // Do NOT mark the order refunded — money did not move.
        logger.error({ orderId: id, psStatus: psRes.status, message: data?.message }, "Paystack refund failed");
        res.status(502).json({ error: `Paystack refund failed: ${data?.message ?? `HTTP ${psRes.status}`}` });
        return;
      }
      paystackRefunded = true;
      logger.info({ orderId: id, reference: order.paymentReference }, "Paystack refund submitted");
    }

    await db.update(ucOrdersTable).set({ status: "refunded" }).where(eq(ucOrdersTable.id, id));
    res.json({ ok: true, id, status: "refunded", paystackRefunded, manual: !paystackRefunded });
  } catch (err) {
    logger.error({ err, orderId: id }, "Failed to refund order");
    res.status(500).json({ error: "Failed to refund order" });
  }
});

// DELETE /api/uc/admin/orders/:id — permanently remove an order + line items.
router.delete("/uc/admin/orders/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) { res.status(403).json({ error: "Admin access required" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid order id" }); return; }

  try {
    const [order] = await db.select().from(ucOrdersTable).where(eq(ucOrdersTable.id, id)).limit(1);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    await db.delete(ucOrderItemsTable).where(eq(ucOrderItemsTable.orderId, id));
    await db.delete(ucOrdersTable).where(eq(ucOrdersTable.id, id));
    logger.info({ orderId: id, status: order.status }, "Admin deleted order");
    res.json({ ok: true, id });
  } catch (err) {
    logger.error({ err, orderId: id }, "Failed to delete order");
    res.status(500).json({ error: "Failed to delete order" });
  }
});

// GET /api/uc/admin/orders/recovery-count — count of unresolved webhook recovery
// orders (not completed and not cancelled). Used by the nav badge so the team
// can see pending recovery orders without navigating to the orders page.
// Requires admin auth. Intentionally lightweight — no line-item joins.
router.get("/uc/admin/orders/recovery-count", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  try {
    const rows = await db
      .select({ id: ucOrdersTable.id })
      .from(ucOrdersTable)
      .where(
        and(
          eq(ucOrdersTable.webhookRecovery, true),
          ne(ucOrdersTable.status, "completed"),
          ne(ucOrdersTable.status, "cancelled"),
        )
      );

    res.json({ count: rows.length });
  } catch (err) {
    logger.error({ err }, "Failed to count recovery orders");
    res.status(500).json({ error: "Failed to count recovery orders" });
  }
});

// ─── Reminder gaps ────────────────────────────────────────────────────────────
// Replacement reminders are driven by the product's lifespanDays (from the
// `filter_lifespan_days` meta). An order whose products all lack a lifespan
// silently produces NO replacement reminder for that customer. This report
// gives the team visibility into those orders so gaps are caught early.

/**
 * Classify a purchased product against the catalogue:
 *   - "missing-lifespan": product exists, needs a lifespan, but has none
 *     (per auditProductLifespans — exemptions for enquiry/accessory apply)
 *   - "unknown-product": product id not found in the catalogue at all, so no
 *     lifespan can ever be resolved for it
 *   - null: product is trackable or legitimately exempt — no gap
 * Exported for tests.
 */
export function classifyReminderGap(
  productId: number,
  catalogueIds: Set<number>,
  flaggedIds: Set<number>,
): "missing-lifespan" | "unknown-product" | null {
  if (!catalogueIds.has(productId)) return "unknown-product";
  return flaggedIds.has(productId) ? "missing-lifespan" : null;
}

// Order statuses that no longer need a reminder — the sale never went through.
const REMINDER_GAP_EXCLUDED_STATUSES = ["cancelled", "refunded", "declined"];

// GET /api/uc/admin/orders/reminder-gaps — admin-only report of orders whose
// line items include a product with no lifespan set (→ no replacement
// reminder will ever be scheduled for that purchase). ProjectHub surfaces
// this in the Orders view as a warning badge per affected order.
router.get("/uc/admin/orders/reminder-gaps", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  try {
    // Resolve the catalogue exactly like the lifespan audit does: live store
    // when credentials exist, otherwise the mock catalogue. A partially
    // unreachable store must fail loudly, never report a false all-clear.
    let source = "mock";
    let normalized: Record<string, unknown>[] | null = null;
    if (hasWCCredentials()) {
      const products = await fetchAllPublishedProducts();
      if (products) {
        normalized = products.map(normalizeProduct);
        source = "woocommerce";
      } else {
        res.status(502).json({ error: "Could not reach the WooCommerce store to check product lifespans" });
        return;
      }
    }
    if (!normalized) normalized = MOCK_PRODUCTS.map(normalizeProduct);

    const catalogueIds = new Set(normalized.map((p) => Number(p["id"])));
    const flaggedIds = new Set(auditProductLifespans(normalized).map((p) => Number(p["id"])));

    const orders = await db
      .select()
      .from(ucOrdersTable)
      .where(notInArray(ucOrdersTable.status, REMINDER_GAP_EXCLUDED_STATUSES))
      .orderBy(desc(ucOrdersTable.dateCreated));

    let gapOrders: {
      id: number;
      userId: string;
      status: string;
      dateCreated: Date | string;
      gapItems: { productId: number; name: string; quantity: number; reason: string }[];
    }[] = [];

    if (orders.length > 0) {
      const items = await db.select().from(ucOrderItemsTable)
        .where(inArray(ucOrderItemsTable.orderId, orders.map(o => o.id)));
      const itemsByOrder = items.reduce<Record<number, typeof items>>((acc, item) => {
        (acc[item.orderId] ??= []).push(item);
        return acc;
      }, {});

      gapOrders = orders.flatMap((o) => {
        const gapItems = (itemsByOrder[o.id] ?? []).flatMap((i) => {
          const reason = classifyReminderGap(i.productId, catalogueIds, flaggedIds);
          return reason
            ? [{ productId: i.productId, name: i.name, quantity: i.quantity, reason }]
            : [];
        });
        return gapItems.length > 0
          ? [{ id: o.id, userId: o.userId, status: o.status, dateCreated: o.dateCreated, gapItems }]
          : [];
      });
    }

    res.json({
      source,
      checkedAt: new Date().toISOString(),
      checkedOrders: orders.length,
      orders: gapOrders,
    });
  } catch (err) {
    logger.error({ err }, "Reminder-gap report failed");
    res.status(500).json({ error: "Reminder-gap report failed" });
  }
});

// GET /api/uc/admin/tickets — all maintenance tickets, most-recent first.
// Accepts optional ?status= filter. Protected by admin auth.
router.get("/uc/admin/tickets", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const dateRange = parseDateRange(req, res);
  if (!dateRange) return;

  try {
    const statusFilter = typeof req.query["status"] === "string" && req.query["status"].trim()
      ? req.query["status"].trim()
      : null;

    const tickets = await db
      .select()
      .from(ucTicketsTable)
      .where(and(
        statusFilter ? eq(ucTicketsTable.status, statusFilter) : undefined,
        dateRange.from ? sql`${ucTicketsTable.createdAt}::date >= ${dateRange.from}::date` : undefined,
        dateRange.to   ? sql`${ucTicketsTable.createdAt}::date <= ${dateRange.to}::date`   : undefined,
      ))
      .orderBy(desc(ucTicketsTable.createdAt));

    res.json(tickets.map(t => ({
      id:                   t.id,
      userId:               t.userId,
      productModel:         t.productModel,
      issueDescription:     t.issueDescription,
      preferredContactTime: t.preferredContactTime,
      photos:               t.photos ?? [],
      videos:               t.videos ?? [],
      status:               t.status,
      createdAt:            t.createdAt,
    })));
  } catch (err) {
    logger.error({ err }, "Failed to load admin tickets");
    res.status(500).json({ error: "Failed to load tickets" });
  }
});

// PATCH /api/uc/admin/tickets/:id — update ticket status. Protected by admin auth.
const TICKET_STATUSES = ["submitted", "in_progress", "resolved"] as const;

router.patch("/uc/admin/tickets/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const id = String(req.params["id"]);
  const { status } = req.body as Record<string, unknown>;

  if (!status || typeof status !== "string" || !status.trim()) {
    res.status(400).json({ error: "status is required" });
    return;
  }

  const normalizedStatus = status.trim();
  if (!(TICKET_STATUSES as readonly string[]).includes(normalizedStatus)) {
    res.status(400).json({
      error: `Invalid status. Allowed values: ${TICKET_STATUSES.join(", ")}`,
    });
    return;
  }

  try {
    const [updated] = await db
      .update(ucTicketsTable)
      .set({ status: normalizedStatus })
      .where(eq(ucTicketsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    res.json({
      id:                   updated.id,
      userId:               updated.userId,
      productModel:         updated.productModel,
      issueDescription:     updated.issueDescription,
      preferredContactTime: updated.preferredContactTime,
      photos:               updated.photos ?? [],
      videos:               updated.videos ?? [],
      status:               updated.status,
      createdAt:            updated.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "Failed to update ticket status");
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

// GET /api/uc/admin/water-tests — all water test bookings, most-recent first.
// Accepts optional ?status= filter. Protected by admin auth.
router.get("/uc/admin/water-tests", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const dateRange = parseDateRange(req, res);
  if (!dateRange) return;

  try {
    const statusFilter = typeof req.query["status"] === "string" && req.query["status"].trim()
      ? req.query["status"].trim()
      : null;

    const waterTests = await db
      .select()
      .from(ucWaterTestsTable)
      .where(and(
        statusFilter ? eq(ucWaterTestsTable.status, statusFilter) : undefined,
        dateRange.from ? sql`${ucWaterTestsTable.createdAt}::date >= ${dateRange.from}::date` : undefined,
        dateRange.to   ? sql`${ucWaterTestsTable.createdAt}::date <= ${dateRange.to}::date`   : undefined,
      ))
      .orderBy(desc(ucWaterTestsTable.createdAt));

    res.json(waterTests.map(w => ({
      id:          w.id,
      userId:      w.userId,
      name:        w.name,
      address:     w.address,
      phone:       w.phone,
      waterSource: w.waterSource,
      concerns:    w.concerns,
      photos:      w.photos ?? [],
      videos:      w.videos ?? [],
      status:      w.status,
      createdAt:   w.createdAt,
    })));
  } catch (err) {
    logger.error({ err }, "Failed to load admin water tests");
    res.status(500).json({ error: "Failed to load water tests" });
  }
});

// ─── Date-range helper ────────────────────────────────────────────────────────
// Parses optional ?from=YYYY-MM-DD and ?to=YYYY-MM-DD query params.
// Returns { from, to } (each nullable) on success, or null after sending a 400.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns true only for a string that is both syntactically YYYY-MM-DD and
 * represents a real calendar date.  Date.parse() alone is not sufficient because
 * V8 silently rolls over invalid days (e.g. "2024-02-30" becomes March 1) instead
 * of returning NaN, so we do a component round-trip check via Date.UTC().
 */
function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const [yearStr, monthStr, dayStr] = s.split("-");
  const year  = Number(yearStr);
  const month = Number(monthStr);
  const day   = Number(dayStr);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth()    === month - 1 &&
    d.getUTCDate()     === day
  );
}

function parseDateRange(
  req: Request,
  res: Response,
): { from: string | null; to: string | null } | null {
  const rawFrom = typeof req.query["from"] === "string" ? req.query["from"].trim() : "";
  const rawTo   = typeof req.query["to"]   === "string" ? req.query["to"].trim()   : "";

  if (rawFrom && !isValidIsoDate(rawFrom)) {
    res.status(400).json({ error: "Invalid ?from= — expected YYYY-MM-DD" });
    return null;
  }
  if (rawTo && !isValidIsoDate(rawTo)) {
    res.status(400).json({ error: "Invalid ?to= — expected YYYY-MM-DD" });
    return null;
  }

  return { from: rawFrom || null, to: rawTo || null };
}

// ─── CSV export helpers ───────────────────────────────────────────────────────
// All cell values go through sanitiseCsvCell (RFC 4180 + formula-injection
// defence: values starting with =, +, -, @ are apostrophe-prefixed).
function csvRow(cells: unknown[]): string {
  return cells.map(v => sanitiseCsvCell(v === null || v === undefined ? "" : String(v))).join(",");
}
function csvTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// GET /api/uc/admin/orders.csv — CSV download of all orders with line items expanded.
// Accepts optional ?status= filter. Protected by admin auth.
router.get("/uc/admin/orders.csv", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) { res.status(403).json({ error: "Admin access required" }); return; }

  const dateRange = parseDateRange(req, res);
  if (!dateRange) return;

  try {
    const statusFilter = typeof req.query["status"] === "string" && req.query["status"].trim()
      ? req.query["status"].trim() : null;

    const orders = await db
      .select()
      .from(ucOrdersTable)
      .where(and(
        statusFilter ? eq(ucOrdersTable.status, statusFilter) : undefined,
        dateRange.from ? sql`${ucOrdersTable.dateCreated}::date >= ${dateRange.from}::date` : undefined,
        dateRange.to   ? sql`${ucOrdersTable.dateCreated}::date <= ${dateRange.to}::date`   : undefined,
      ))
      .orderBy(desc(ucOrdersTable.dateCreated));

    let items: (typeof ucOrderItemsTable.$inferSelect)[] = [];
    const itemsByOrder: Record<number, typeof items> = {};
    if (orders.length > 0) {
      const orderIds = orders.map(o => o.id);
      items = await db.select().from(ucOrderItemsTable).where(inArray(ucOrderItemsTable.orderId, orderIds));
      for (const item of items) {
        (itemsByOrder[item.orderId] ??= []).push(item);
      }
    }

    // Determine the maximum number of line items across all orders for column expansion.
    const maxItems = Math.max(0, ...orders.map(o => (itemsByOrder[o.id] ?? []).length));

    // Build header row.
    const itemHeaders: string[] = [];
    for (let i = 1; i <= maxItems; i++) {
      itemHeaders.push(
        `item_${i}_productId`, `item_${i}_name`, `item_${i}_qty`, `item_${i}_total`,
      );
    }
    const header = csvRow([
      "id", "userId", "status", "dateCreated", "total", "currency",
      "paymentMethod", "paymentReference", "promoCode",
      "discountPercent", "discountAmount", "webhookRecovery",
      "shippingName", "shippingPhone", "shippingAddress", "shippingCity", "shippingCountry",
      ...itemHeaders,
    ]);

    const dataRows = orders.map(o => {
      const addr = (o.shippingAddress ?? {}) as Record<string, unknown>;
      // Checkout persists firstName/lastName/address1; fall back to legacy name/address keys.
      const shippingName = [addr["firstName"], addr["lastName"]].filter(Boolean).join(" ")
        || String(addr["name"] ?? "");
      const shippingAddr = String(addr["address1"] ?? addr["address"] ?? "");
      const lineItems = itemsByOrder[o.id] ?? [];
      const itemCells: unknown[] = [];
      for (let i = 0; i < maxItems; i++) {
        const li = lineItems[i];
        itemCells.push(li?.productId ?? "", li?.name ?? "", li?.quantity ?? "", li?.total ?? "");
      }
      return csvRow([
        o.id, o.userId, o.status, new Date(o.dateCreated).toISOString(), o.total, o.currency,
        o.paymentMethod, o.paymentReference ?? "", o.promoCode ?? "",
        o.discountPercent, o.discountAmount, o.webhookRecovery ?? false,
        shippingName, addr["phone"] ?? "", shippingAddr, addr["city"] ?? "", addr["country"] ?? "",
        ...itemCells,
      ]);
    });

    const csv = [header, ...dataRows].join("\r\n") + "\r\n";
    const filename = `orders_${csvTimestamp()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    logger.error({ err }, "Failed to export orders CSV");
    res.status(500).json({ error: "Failed to export orders" });
  }
});

// GET /api/uc/admin/tickets.csv — CSV download of all maintenance tickets.
// Accepts optional ?status= filter. Protected by admin auth.
router.get("/uc/admin/tickets.csv", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) { res.status(403).json({ error: "Admin access required" }); return; }

  const dateRange = parseDateRange(req, res);
  if (!dateRange) return;

  try {
    const statusFilter = typeof req.query["status"] === "string" && req.query["status"].trim()
      ? req.query["status"].trim() : null;

    const tickets = await db
      .select()
      .from(ucTicketsTable)
      .where(and(
        statusFilter ? eq(ucTicketsTable.status, statusFilter) : undefined,
        dateRange.from ? sql`${ucTicketsTable.createdAt}::date >= ${dateRange.from}::date` : undefined,
        dateRange.to   ? sql`${ucTicketsTable.createdAt}::date <= ${dateRange.to}::date`   : undefined,
      ))
      .orderBy(desc(ucTicketsTable.createdAt));

    const header = csvRow([
      "id", "userId", "productModel", "issueDescription",
      "preferredContactTime", "photoCount", "videoCount", "status", "createdAt",
    ]);
    const dataRows = tickets.map(t => csvRow([
      t.id, t.userId, t.productModel, t.issueDescription,
      t.preferredContactTime, (t.photos ?? []).length, (t.videos ?? []).length,
      t.status, t.createdAt,
    ]));

    const csv = [header, ...dataRows].join("\r\n") + "\r\n";
    const filename = `tickets_${csvTimestamp()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    logger.error({ err }, "Failed to export tickets CSV");
    res.status(500).json({ error: "Failed to export tickets" });
  }
});

// GET /api/uc/admin/water-tests.csv — CSV download of all water test bookings.
// Accepts optional ?status= filter. Protected by admin auth.
router.get("/uc/admin/water-tests.csv", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) { res.status(403).json({ error: "Admin access required" }); return; }

  const dateRange = parseDateRange(req, res);
  if (!dateRange) return;

  try {
    const statusFilter = typeof req.query["status"] === "string" && req.query["status"].trim()
      ? req.query["status"].trim() : null;

    const waterTests = await db
      .select()
      .from(ucWaterTestsTable)
      .where(and(
        statusFilter ? eq(ucWaterTestsTable.status, statusFilter) : undefined,
        dateRange.from ? sql`${ucWaterTestsTable.createdAt}::date >= ${dateRange.from}::date` : undefined,
        dateRange.to   ? sql`${ucWaterTestsTable.createdAt}::date <= ${dateRange.to}::date`   : undefined,
      ))
      .orderBy(desc(ucWaterTestsTable.createdAt));

    const header = csvRow([
      "id", "userId", "name", "address", "phone",
      "waterSource", "concerns", "photoCount", "videoCount", "status", "createdAt",
    ]);
    const dataRows = waterTests.map(w => csvRow([
      w.id, w.userId, w.name, w.address, w.phone,
      w.waterSource, w.concerns, (w.photos ?? []).length, (w.videos ?? []).length,
      w.status, w.createdAt,
    ]));

    const csv = [header, ...dataRows].join("\r\n") + "\r\n";
    const filename = `water-tests_${csvTimestamp()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    logger.error({ err }, "Failed to export water tests CSV");
    res.status(500).json({ error: "Failed to export water tests" });
  }
});

// PATCH /api/uc/admin/water-tests/:id — update water test booking status. Protected by admin auth.
const WATER_TEST_STATUSES = ["pending", "scheduled", "completed"] as const;

router.patch("/uc/admin/water-tests/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const id = String(req.params["id"]);
  const { status } = req.body as Record<string, unknown>;

  if (!status || typeof status !== "string" || !status.trim()) {
    res.status(400).json({ error: "status is required" });
    return;
  }

  const normalizedStatus = status.trim();
  if (!(WATER_TEST_STATUSES as readonly string[]).includes(normalizedStatus)) {
    res.status(400).json({
      error: `Invalid status. Allowed values: ${WATER_TEST_STATUSES.join(", ")}`,
    });
    return;
  }

  try {
    const [updated] = await db
      .update(ucWaterTestsTable)
      .set({ status: normalizedStatus })
      .where(eq(ucWaterTestsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Water test not found" });
      return;
    }

    res.json({
      id:          updated.id,
      userId:      updated.userId,
      name:        updated.name,
      address:     updated.address,
      phone:       updated.phone,
      waterSource: updated.waterSource,
      concerns:    updated.concerns,
      photos:      updated.photos ?? [],
      videos:      updated.videos ?? [],
      status:      updated.status,
      createdAt:   updated.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "Failed to update water test status");
    res.status(500).json({ error: "Failed to update water test" });
  }
});

// ─── Admin notification log endpoints ────────────────────────────────────────

/**
 * GET /api/uc/admin/notification-logs
 * Returns recent SMS/email send attempts from uc_notification_log.
 * Accepts optional ?status=failed|sent and ?limit=N (default 100).
 * Protected by admin auth.
 */
router.get("/uc/admin/notification-logs", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  try {
    const statusFilter = typeof req.query["status"] === "string" && req.query["status"].trim()
      ? req.query["status"].trim()
      : null;
    const limit = Math.min(
      Number(req.query["limit"]) > 0 ? Number(req.query["limit"]) : 100,
      500,
    );

    const rows = await db
      .select()
      .from(ucNotificationLogTable)
      .where(statusFilter ? eq(ucNotificationLogTable.status, statusFilter) : undefined)
      .orderBy(desc(ucNotificationLogTable.sentAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to load notification logs");
    res.status(500).json({ error: "Failed to load notification logs" });
  }
});

/**
 * POST /api/uc/admin/notification-logs/:id/retry
 * Re-sends the notification described by a FAILED log row.
 * - SMS: re-sends the stored messageBody (full SMS text) to the stored recipient.
 * - Email: re-sends the stored plain-text body with a human-readable subject
 *   derived from the template name. The stored messageBody is the full
 *   plain-text version of the original email (populated by sms.ts / email.ts).
 * Only rows with status='failed' may be retried.
 * Protected by admin auth.
 */
router.post("/uc/admin/notification-logs/:id/retry", async (req: Request, res: Response): Promise<void> => {
  const admin = await isAdminRequest(req.headers["authorization"]);
  if (!admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const logId = Number(req.params["id"]);
  if (!logId) {
    res.status(400).json({ error: "Invalid log id" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(ucNotificationLogTable)
      .where(eq(ucNotificationLogTable.id, logId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Log entry not found" });
      return;
    }

    // Only failed notifications make sense to retry.
    if (row.status !== "failed") {
      res.status(400).json({ error: "Only failed notifications can be retried" });
      return;
    }

    // Guard against retrying a failure already superseded by a later successful
    // delivery (e.g. Resend fails → sendEmail fallback succeeds).
    // Use the most specific identity available: entity ID (orderId / ticketId /
    // testId) when present, or template when not, so an unrelated later message
    // to the same recipient on a different entity does NOT block the retry.
    let supersessionWhere;
    if (row.orderId != null) {
      supersessionWhere = and(
        eq(ucNotificationLogTable.channel,   row.channel),
        eq(ucNotificationLogTable.recipient, row.recipient),
        eq(ucNotificationLogTable.orderId,   row.orderId),
        eq(ucNotificationLogTable.status,    "sent"),
        gt(ucNotificationLogTable.sentAt,    row.sentAt),
      );
    } else if (row.ticketId) {
      supersessionWhere = and(
        eq(ucNotificationLogTable.channel,   row.channel),
        eq(ucNotificationLogTable.recipient, row.recipient),
        eq(ucNotificationLogTable.ticketId,  row.ticketId),
        eq(ucNotificationLogTable.status,    "sent"),
        gt(ucNotificationLogTable.sentAt,    row.sentAt),
      );
    } else if (row.testId) {
      supersessionWhere = and(
        eq(ucNotificationLogTable.channel,   row.channel),
        eq(ucNotificationLogTable.recipient, row.recipient),
        eq(ucNotificationLogTable.testId,    row.testId),
        eq(ucNotificationLogTable.status,    "sent"),
        gt(ucNotificationLogTable.sentAt,    row.sentAt),
      );
    } else if (row.template) {
      supersessionWhere = and(
        eq(ucNotificationLogTable.channel,   row.channel),
        eq(ucNotificationLogTable.recipient, row.recipient),
        eq(ucNotificationLogTable.template,  row.template),
        eq(ucNotificationLogTable.status,    "sent"),
        gt(ucNotificationLogTable.sentAt,    row.sentAt),
      );
    }
    // If no identity anchor is available, skip the supersession check.

    if (supersessionWhere) {
      const [laterSuccess] = await db
        .select({ id: ucNotificationLogTable.id })
        .from(ucNotificationLogTable)
        .where(supersessionWhere)
        .limit(1);

      if (laterSuccess) {
        res.status(409).json({
          error: "A later successful delivery already exists for this notification — retry is not needed",
        });
        return;
      }
    }

    if (row.channel === "sms") {
      // messageBody stores the full SMS text — re-send as-is.
      sendSms(row.recipient, row.messageBody, {
        template: row.template || undefined,
        orderId:  row.orderId ?? undefined,
        ticketId: row.ticketId ?? undefined,
        testId:   row.testId ?? undefined,
      });
    } else if (row.channel === "email") {
      // messageBody stores the full plain-text body of the original email.
      // Derive a human-readable subject from the template name.
      // Always HTML-escape the body before interpolation to prevent injection.
      const retrySubject = row.template
        ? `Ultra Clear — ${row.template.replace(/_/g, " ")} (re-sent)`
        : "Your Ultra Clear notification (re-sent)";
      const safeBody    = row.messageBody || "(original message unavailable — please contact support)";
      const escapedBody = escapeHtml(safeBody);
      sendEmail({
        to:       row.recipient,
        subject:  retrySubject,
        html:     `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapedBody}</pre>`,
        text:     safeBody,
        template: row.template || undefined,
        orderId:  row.orderId ?? undefined,
        ticketId: row.ticketId ?? undefined,
        testId:   row.testId ?? undefined,
      });
    } else {
      res.status(400).json({ error: `Unknown channel: ${row.channel}` });
      return;
    }

    res.json({ ok: true, message: `Retry queued for ${row.channel} to ${row.recipient}` });
  } catch (err) {
    logger.error({ err, logId }, "Failed to retry notification");
    res.status(500).json({ error: "Failed to retry notification" });
  }
});

// ─── Push notifications infrastructure ──────────────────────────────────────

/**
 * Verify the Bearer JWT and return a stable user-identity string.
 * Returns "anonymous" when the token is absent, invalid, or unchanged.
 */
function userIdFromBearer(authHeader: string | undefined): string {
  const claims = verifyToken(authHeader);
  if (!claims) return "anonymous";
  return String(claims.id ?? claims.email ?? "anonymous");
}

/** Retrieve a user's push token row from the database. Returns null if not found. */
async function getPushTokenRow(userId: string): Promise<{ pushToken: string; optOutOrders: boolean } | null> {
  try {
    const row = await db.query.ucPushTokensTable.findFirst({
      where: eq(ucPushTokensTable.userId, userId),
    });
    if (!row) return null;
    return { pushToken: row.pushToken, optOutOrders: row.optOutOrders };
  } catch {
    return null;
  }
}

/** Remove a stale / unregistered token from the database. */
async function removePushToken(userId: string): Promise<void> {
  try {
    await db.delete(ucPushTokensTable).where(eq(ucPushTokensTable.userId, userId));
  } catch { /* ignore */ }
}

/**
 * Send a single push notification via the Expo Push API.
 * Returns true if the token is stale (DeviceNotRegistered) so the caller
 * can clean it up.
 */
async function callExpoPushApi(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<{ staleToken: boolean }> {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "Accept":          "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify([{ to: token, title, body, data }]),
  });
  try {
    const json = await res.json() as { data?: Array<{ status: string; details?: { error?: string } }> };
    const ticket = json?.data?.[0];
    if (ticket?.status === "error" && ticket?.details?.error === "DeviceNotRegistered") {
      return { staleToken: true };
    }
  } catch { /* response body parse error — not a stale token */ }
  return { staleToken: false };
}

/**
 * Look up the registered push token for a user from the DB and fire a notification.
 * Fire-and-forget: failures are swallowed so they never block the caller.
 * Automatically removes stale tokens that Expo reports as unregistered.
 */
/**
 * Send a push notification to a user, respecting their opt-out preferences.
 * `category` controls which opt-out flag is checked:
 *   - "orders": checked against optOutOrders
 */
function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  category: "orders" | "general" = "general"
): void {
  getPushTokenRow(userId).then(async (row) => {
    if (!row) return;
    if (category === "orders" && row.optOutOrders) return;
    const { staleToken } = await callExpoPushApi(row.pushToken, title, body, data);
    if (staleToken) await removePushToken(userId);
  }).catch(() => { /* ignore */ });
}

// ─── Contact lookup helper ────────────────────────────────────────────────────
/** Look up phone, email, and firstName for a registered DB user. Returns null
 *  for mock/legacy string ids (timestamps) or when the DB is unavailable. */
async function getUserContact(
  userId: string,
): Promise<{ phone: string; email: string; firstName: string } | null> {
  const numericId = Number(userId);
  if (isNaN(numericId) || numericId <= 0 || numericId >= 1_000_000_000) return null;
  try {
    const row = await db.query.ucUsersTable.findFirst({
      where: eq(ucUsersTable.id, numericId),
    });
    if (!row) return null;
    return { phone: row.phone, email: row.email, firstName: row.firstName };
  } catch {
    return null;
  }
}

// ─── Order confirmation email helper ─────────────────────────────────────────
/**
 * Fire-and-forget: look up the user's contact details from the DB and send an
 * order-confirmation email via Resend (falling back to the legacy SMTP provider
 * when Resend fails).  Exported so integration tests can call it directly.
 *
 * Never throws — all errors are logged and swallowed so a notification failure
 * can never prevent an order response from reaching the client.
 */
export function sendOrderConfirmationEmail(
  ownerUserId: string,
  order: {
    orderId:         string | number;
    lineItems:       Array<{ name?: string; quantity?: number; total?: string }>;
    total:           string;
    currency:        string;
    paymentMethod:   string;
    shippingAddress?: Record<string, string>;
    discountAmount?:  number;
    promoCode?:       string;
  },
): void {
  getUserContact(ownerUserId).then(contact => {
    if (contact?.phone) {
      sendSms(contact.phone, orderConfirmationSms({
        orderId:   order.orderId,
        total:     order.total,
        firstName: contact.firstName,
      }), { template: "order_confirmation", orderId: order.orderId });
    }
    if (contact?.email) {
      const receipt = buildOrderReceiptEmail({
        orderId:         order.orderId,
        firstName:       contact.firstName,
        email:           contact.email,
        lineItems:       order.lineItems,
        total:           order.total,
        currency:        order.currency,
        paymentMethod:   order.paymentMethod,
        shippingAddress: order.shippingAddress,
        discountAmount:  order.discountAmount,
        promoCode:       order.promoCode,
      });
      sendViaResend({
        from:    "orders@contacts.ucfilters.com",
        to:      contact.email,
        subject: receipt.subject,
        text:    receipt.text,
        html:    receipt.html,
        meta:    { template: "order_receipt", orderId: order.orderId },
      }).then(ok => {
        if (!ok) {
          logger.warn(`[resend] order confirmation not delivered to ${contact.email}; trying legacy email provider`);
          sendEmail({ to: contact.email, ...receipt, template: "order_receipt", orderId: order.orderId });
        }
      });
    }
  }).catch(() => {});
}

// ─── Filter registration from purchase record ────────────────────────────────
// POST /api/uc/filters/register-purchase
//
// A customer registers their installed filter with the receipt/order number
// plus the phone number used at checkout. Deliberately NO new table: the
// lookup runs against existing purchase records — app DB orders first, then
// the live WooCommerce store — so repeat purchases and multi-filter receipts
// reuse the same data. The response carries only what the mobile tracker
// needs (products + purchase date), never names or addresses.
//
// Anti-enumeration: rate-limited per IP, and the 404 message is identical for
// "no such order" and "phone doesn't match" so receipts can't be fished.

/** Compare phone numbers by their last 9 digits (Kenyan mobile significant
 *  digits) so 07XX…, +2547XX… and 2547XX… all match each other. */
function phonesMatch(a: unknown, b: unknown): boolean {
  const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-9);
  const da = digits(a);
  return da.length === 9 && da === digits(b);
}

// Statuses whose purchase records may be used for registration. Cancelled,
// refunded, failed and in-flight anchor ("pending-wc") orders are excluded.
const REGISTRABLE_STATUSES = new Set([
  "completed", "processing", "on-hold", "shipped", "delivered",
]);

const REGISTER_NOT_FOUND_MSG =
  "No purchase found matching that receipt number and phone number.";

router.post(
  "/uc/filters/register-purchase",
  lookupLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { receipt, phone } = req.body as { receipt?: unknown; phone?: unknown };
    const receiptDigits = String(receipt ?? "").trim().replace(/^#/, "");
    const phoneDigits = String(phone ?? "").replace(/\D/g, "");
    if (!/^\d{1,10}$/.test(receiptDigits) || phoneDigits.length < 9) {
      res.status(400).json({
        error: "Enter your receipt number and the phone number used at purchase.",
      });
      return;
    }
    const orderId = Number(receiptDigits);

    type RegisterItem = {
      productId: number; name: string; quantity: number; lifespanDays: number;
    };
    const respond = async (
      source: "app" | "store",
      status: string,
      dateCreated: unknown,
      rawItems: { productId: number; name: string; quantity: number }[],
    ): Promise<void> => {
      if (!REGISTRABLE_STATUSES.has(status)) {
        res.status(409).json({
          error: "This purchase is not active (cancelled or refunded), so it can't be used for registration.",
        });
        return;
      }
      const lifespans = await getProductLifespanMap();
      if (!lifespans) {
        res.status(503).json({
          error: "Product catalogue temporarily unreachable — please try again shortly.",
          retryable: true,
        });
        return;
      }
      const items: RegisterItem[] = rawItems.map((i) => ({
        ...i,
        lifespanDays: lifespans.get(i.productId) ?? 0, // 0 = not trackable, never guessed
      }));
      res.json({ source, orderId, status, dateCreated, items });
    };

    // 1) App DB purchase record
    let dbFailed = false;
    try {
      const [row] = await db
        .select()
        .from(ucOrdersTable)
        .where(eq(ucOrdersTable.id, orderId))
        .limit(1);
      if (row) {
        const addr = (row.shippingAddress ?? {}) as Record<string, string>;
        if (phonesMatch(addr["phone"], phone)) {
          const items = await db
            .select()
            .from(ucOrderItemsTable)
            .where(eq(ucOrderItemsTable.orderId, row.id));
          await respond(
            "app",
            row.status,
            row.dateCreated,
            items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity })),
          );
          return;
        }
        // Phone mismatch → fall through to the generic 404 (no enumeration).
      }
    } catch (err) {
      dbFailed = true;
      logger.error({ err }, "[register-purchase] app DB lookup failed");
    }

    // 2) Live store purchase record (store receipts / orders placed on the site)
    if (hasWCCredentials()) {
      const o = await wcFetchOne(`/orders/${orderId}`);
      if (o && Number(o["id"]) === orderId) {
        const billing = (o["billing"] ?? {}) as Record<string, unknown>;
        const shipping = (o["shipping"] ?? {}) as Record<string, unknown>;
        if (phonesMatch(billing["phone"], phone) || phonesMatch(shipping["phone"], phone)) {
          const rawItems = Array.isArray(o["line_items"])
            ? (o["line_items"] as Record<string, unknown>[]).map((i) => ({
                productId: Number(i["product_id"]),
                name: String(i["name"] ?? ""),
                quantity: Number(i["quantity"]) || 1,
              }))
            : [];
          await respond("store", String(o["status"] ?? ""), o["date_created"], rawItems);
          return;
        }
      }
    }

    // A DB outage must not masquerade as "no such purchase".
    if (dbFailed) {
      res.status(503).json({
        error: "Purchase records temporarily unreachable — please try again shortly.",
        retryable: true,
      });
      return;
    }
    res.status(404).json({ error: REGISTER_NOT_FOUND_MSG });
  },
);

// ─── Orders ──────────────────────────────────────────────────────────────────
router.post("/uc/orders", async (req: Request, res: Response): Promise<void> => {
  // Capture the caller's identity up-front so we can send a push notification
  // after the order is created without re-parsing the header each time.
  const orderUserId = userIdFromBearer(req.headers["authorization"]);
  const orderNumericId = Number(orderUserId);
  if (await guardDeletedAccount(orderNumericId, res)) return;

  const { lineItems, paymentMethod, paymentReference, shippingAddress, promoCode, userEmail } =
    req.body as {
      lineItems: { productId: number; quantity: number }[];
      paymentMethod: string;
      paymentReference?: string;
      shippingAddress?: Record<string, string>;
      promoCode?: string;            // referral or promotion code
      userEmail?: string;            // used to gate referral first-order discount
    };
  if (!lineItems || !paymentMethod) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // Server-side payment verification — gate order creation on confirmed payment.
  const verification = await verifyPaymentOnServer(paymentMethod, paymentReference ?? "");
  if (!verification.ok) {
    // Use 503 (not 402) for transient failures so the client's ApiError
    // treats status >= 500 as retryable and offers the right advice.
    const httpStatus = verification.retryable ? 503 : 402;
    res.status(httpStatus).json({
      error: "Payment not verified",
      reason: verification.reason,
      ...(verification.retryable ? { retryable: true } : {}),
    });
    return;
  }

  // ── Idempotency guard ───────────────────────────────────────────────────────
  // If a non-empty paymentReference already has a *confirmed* order in the DB
  // (status != "pending-wc"), return it immediately without inserting a second
  // row or sending another email.
  // "pending-wc" records are WooCommerce in-flight anchors that have not yet
  // been confirmed — they are intentionally skipped here so the WC block can
  // either confirm them (update to "processing") or release them on failure.
  if (paymentReference) {
    try {
      const [existingOrder] = await db
        .select()
        .from(ucOrdersTable)
        .where(
          and(
            eq(ucOrdersTable.paymentReference, paymentReference),
            ne(ucOrdersTable.paymentReference, ""),
            ne(ucOrdersTable.status, "pending-wc"),
          )
        )
        .limit(1);

      if (existingOrder) {
        logger.info(
          { orderId: existingOrder.id },
          `[orders] duplicate paymentReference "${paymentReference}" — returning existing order`,
        );
        const existingItems = await db
          .select()
          .from(ucOrderItemsTable)
          .where(eq(ucOrderItemsTable.orderId, existingOrder.id));

        // If the existing row was created by the webhook recovery path it was
        // only recorded for team fulfilment — no customer confirmation email was
        // sent.  The first app call with a valid authenticated user should emit
        // that receipt now, and mark the row so subsequent retries skip it.
        if (existingOrder.webhookRecovery) {
          await db.update(ucOrdersTable)
            .set({ webhookRecovery: false })
            .where(eq(ucOrdersTable.id, existingOrder.id))
            .catch(() => {});
          const li = existingItems.map(i => ({
            name:     i.name,
            quantity: i.quantity,
            total:    i.total,
          }));
          sendOrderConfirmationEmail(orderUserId, {
            orderId:       existingOrder.id,
            lineItems:     li,
            total:         existingOrder.total,
            currency:      existingOrder.currency,
            paymentMethod: existingOrder.paymentMethod,
            shippingAddress: existingOrder.shippingAddress as Record<string, string> | undefined,
          });
        }

        res.json({
          id:              existingOrder.id,
          status:          existingOrder.status,
          dateCreated:     existingOrder.dateCreated,
          total:           existingOrder.total,
          currency:        existingOrder.currency,
          paymentMethod:   existingOrder.paymentMethod,
          shippingAddress: existingOrder.shippingAddress ?? {},
          discountPercent: existingOrder.discountPercent,
          discountAmount:  existingOrder.discountAmount,
          promoCode:       existingOrder.promoCode ?? "",
          lineItems:       existingItems.map(i => ({
            productId: i.productId,
            name:      i.name,
            quantity:  i.quantity,
            total:     i.total,
          })),
        });
        return;
      }
    } catch (dupCheckErr) {
      // DB temporarily unavailable — log and continue so the order is not lost
      logger.warn({ err: dupCheckErr }, "[orders] idempotency pre-check failed, proceeding");
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  // Resolve discount from promo/referral code (server re-validates; client cannot fake this)
  let discountPercent = 0;
  let discountType: "referral" | "promotion" | null = null;
  if (promoCode?.trim()) {
    const validation = validateCodeForDiscount(promoCode.trim(), userEmail ?? "");
    if (validation.valid) {
      discountPercent = validation.discountPercent;
      discountType = validation.type;
    }
  }

  const isPaid = paymentMethod !== "cod";

  // Compute order total after discount (500 KES delivery already included by client)
  const productLines = lineItems.map((i) => {
    const p = MOCK_PRODUCTS.find((m) => m["id"] === i.productId);
    const price = parseFloat((p?.["price"] as string | undefined) ?? "0");
    return {
      productId: i.productId,
      name: (p?.["name"] as string | undefined) ?? "Product",
      quantity: i.quantity,
      subtotal: price * i.quantity,
    };
  });
  const subtotal = productLines.reduce((s, i) => s + i.subtotal, 0);
  const delivery = 500;
  const gross = subtotal + delivery;
  const discountAmount = Math.round((gross * discountPercent) / 100);
  const netTotal = gross - discountAmount;

  // ── WC order reconciliation helper ─────────────────────────────────────────
  // Paginates through recent WC orders (newest first) to find one carrying an
  // exact payment_reference match in meta_data.  We do NOT rely on WooCommerce's
  // meta_key/meta_value collection filter — that parameter is not part of the
  // documented WC REST API v3 spec and may be silently ignored on many
  // installations, causing unfiltered results that a secondary scan would
  // incorrectly treat as "not_found" and proceed to POST a duplicate.
  //
  // Instead we paginate deterministically through up to MAX_PAGES pages so that
  // "not_found" only fires after exhausting all pages — a reliable confirmed
  // absence within a practical order-volume bound.
  //
  // Returns a tri-state so callers can distinguish a confirmed absence from a
  // lookup failure:
  //   { status: "found",     order }  — exact match in WC
  //   { status: "not_found" }         — all pages exhausted; reference not in WC
  //   { status: "error" }             — WC query itself failed (network / creds)
  type WcLookupResult =
    | { status: "found"; order: Record<string, unknown> }
    | { status: "not_found" }
    | { status: "error" };

  async function findWcOrderByRef(ref: string): Promise<WcLookupResult> {
    const PER_PAGE = 100;
    const MAX_PAGES = 5; // up to 500 orders before failing closed

    for (let page = 1; page <= MAX_PAGES; page++) {
      const orders = await wcFetchArray("/orders", {
        per_page: String(PER_PAGE),
        page:     String(page),
        status:   "any",
        orderby:  "date",
        order:    "desc",
      });

      if (orders === null) return { status: "error" };

      for (const o of orders) {
        const meta = o["meta_data"];
        if (!Array.isArray(meta)) continue;
        const found = (meta as Array<Record<string, unknown>>).some(
          m => m["key"] === "payment_reference" && m["value"] === ref
        );
        if (found) return { status: "found", order: o };
      }

      // A page shorter than PER_PAGE is the terminal page — we have seen every
      // WC order and can confirm the reference is absent.
      if (orders.length < PER_PAGE) return { status: "not_found" };
    }

    // We reached the scan limit (MAX_PAGES × PER_PAGE) without a terminal short
    // page, so there may be additional WC orders beyond our window.  We cannot
    // confirm absence — fail closed to prevent a duplicate POST.
    return { status: "error" };
  }

  // ── WC confirmation helper ──────────────────────────────────────────────────
  // Atomically transitions the anchor from "pending-wc" to "processing" and
  // returns true only when THIS call won the state transition.  Callers must
  // send notifications ONLY when this returns true.
  async function confirmWcAnchor(anchorId: number): Promise<boolean> {
    const updated = await db.update(ucOrdersTable)
      .set({ status: "processing" })
      .where(and(eq(ucOrdersTable.id, anchorId), eq(ucOrdersTable.status, "pending-wc")))
      .returning()
      .catch((e: unknown) => {
        logger.warn({ err: e, anchorId }, "[orders] confirmWcAnchor DB update failed");
        return [] as { id: number }[];
      });
    return updated.length > 0;
  }

  // ── WC notification helper ──────────────────────────────────────────────────
  // Fire-and-forget push + SMS + email for a confirmed WC order.  Must be
  // called ONLY by the request that won the confirmWcAnchor race.
  function sendWcOrderNotifications(
    normalized: Record<string, unknown>,
    ownerUserId: string,
  ): void {
    sendPushToUser(
      ownerUserId,
      "✅ Order confirmed!",
      `Your order #${normalized["id"] ?? "–"} is being processed.`,
      { screen: "orders", orderId: String(normalized["id"] ?? "") },
      "orders"
    );
    sendOrderConfirmationEmail(ownerUserId, {
      orderId:       normalized["id"] as string | number,
      lineItems:     (normalized["lineItems"] as Array<{ name: string; quantity: number; total: string }> | undefined) ?? [],
      total:         String(normalized["total"] ?? "0"),
      currency:      String(normalized["currency"] ?? "KES"),
      paymentMethod: String(normalized["paymentMethod"] ?? ""),
      shippingAddress: normalized["shippingAddress"] as Record<string, string> | undefined,
    });
  }

  try {
    if (hasWCCredentials()) {
      // ── WooCommerce idempotency: claim → call → confirm ───────────────────
      //
      // Step 1: Atomically insert a "pending-wc" anchor + line items into
      //   uc_orders / uc_order_items inside a DB transaction BEFORE calling
      //   WooCommerce.  If either insert fails the whole transaction rolls back.
      //   The "pending-wc" sentinel is skipped by the pre-check above so it
      //   never causes a confirmed-order early return.
      //
      // Step 2: Call WooCommerce.
      //
      // Step 3a (WC success): Call confirmWcAnchor — atomically UPDATE WHERE
      //   status='pending-wc'.  Send notifications ONLY when it returns true
      //   (this request won the race).  Concurrent requests that lose skip
      //   notifications and return the same WC order.
      //
      // Step 3b (WC failure): Reconcile by inspecting each candidate WC order's
      //   meta_data for an EXACT payment_reference match.  If found → try atomic
      //   confirmation → notify only if we won.  If uncertain (no match or WC
      //   query fails) → keep anchor intact, return retriable 503.  Anchors for
      //   permanently failed WC calls are cleaned up by a periodic job.

      let wcAnchorId: number | null = null;

      if (paymentReference) {
        try {
          // Atomic insert of anchor + items — if either fails, both roll back.
          wcAnchorId = await db.transaction(async (tx) => {
            const [anchor] = await tx.insert(ucOrdersTable).values({
              userId:           orderUserId,
              status:           "pending-wc",
              total:            String(netTotal),
              currency:         "KES",
              paymentMethod,
              paymentReference,
              promoCode:        promoCode ?? "",
              discountPercent,
              discountAmount,
              shippingAddress:  shippingAddress ?? {},
            }).returning();
            const anchorId = anchor!.id;
            if (productLines.length > 0) {
              await tx.insert(ucOrderItemsTable).values(
                productLines.map(({ productId, name, quantity, subtotal: t }) => ({
                  orderId:   anchorId,
                  productId,
                  name,
                  quantity,
                  total:     String(t),
                }))
              );
            }
            return anchorId;
          });
        } catch (claimErr) {
          // DrizzleQueryError wraps the pg error in `.cause`; check both locations.
          const _wcPgCode =
            (claimErr as { code?: string }).code ??
            (claimErr as { cause?: { code?: string } }).cause?.code;
          if (_wcPgCode === "23505") {
            const [winner] = await db
              .select()
              .from(ucOrdersTable)
              .where(and(
                eq(ucOrdersTable.paymentReference, paymentReference),
                ne(ucOrdersTable.paymentReference, ""),
              ))
              .limit(1);

            if (winner?.status === "processing") {
              // Confirmed order — return without re-notifying.
              logger.info(
                { orderId: winner.id },
                "[orders] WC idempotency conflict — returning existing confirmed order",
              );
              const winnerItems = await db
                .select()
                .from(ucOrderItemsTable)
                .where(eq(ucOrderItemsTable.orderId, winner.id));
              res.json({
                id:              winner.id,
                status:          winner.status,
                dateCreated:     winner.dateCreated,
                total:           winner.total,
                currency:        winner.currency,
                paymentMethod:   winner.paymentMethod,
                shippingAddress: winner.shippingAddress ?? {},
                discountPercent: winner.discountPercent,
                discountAmount:  winner.discountAmount,
                promoCode:       winner.promoCode ?? "",
                lineItems:       winnerItems.map(i => ({
                  productId: i.productId,
                  name:      i.name,
                  quantity:  i.quantity,
                  total:     i.total,
                })),
              });
              return;
            }

            if (winner?.status === "pending-wc") {
              // A stale "pending-wc" anchor from a previous failed attempt.
              // Reconcile against WC: if the order exists there, confirm it;
              // if not (or the query itself fails), keep the anchor intact so
              // the next retry can attempt reconciliation again — never delete
              // an anchor on uncertain data.
              const wcLookup = await findWcOrderByRef(paymentReference);
              if (wcLookup.status === "found") {
                // WC has the order — atomically claim the confirmation.
                // Only the request that wins the status transition sends
                // notifications; concurrent requests skip them and return.
                // Use the anchor's persisted userId (winner.userId), NOT the
                // retry caller's identity, to correctly address the customer.
                const normalized = normalizeOrder(wcLookup.order);
                const iConfirmed = await confirmWcAnchor(winner.id);
                if (iConfirmed) sendWcOrderNotifications(normalized, winner.userId);
                res.json(normalized);
                return;
              }
              // "not_found" or "error" — both mean we cannot confirm the anchor.
              // Keep it intact so the next retry can attempt reconciliation again.
              res.status(503).json({ error: "Order is being processed, please retry shortly", retryable: true });
              return;
            }
          }
          logger.error({ err: claimErr }, "[orders] idempotency claim failed before WC");
          res.status(503).json({ error: "Service temporarily unavailable, please retry", retryable: true });
          return;
        }
      }

      // ── WC pre-flight deduplication check ────────────────────────────────
      // Before POSTing to WooCommerce, query it for an existing order that
      // already carries this payment_reference in meta_data.  This covers the
      // scenario where the DB was briefly unavailable on a prior attempt so the
      // DB guard did not fire, but WC already accepted the order — without this
      // guard a retry would POST a second WC order for the same payment.
      //
      // Tri-state handling:
      //   "found"     → skip POST, confirm anchor, return normalised order.
      //   "not_found" → safe to proceed with POST (WC confirmed no match).
      //   "error"     → fail closed: retain anchor, return retriable 503.
      //                 A WC lookup failure is indistinguishable from "order
      //                 exists but temporarily unreachable" — proceeding would
      //                 risk a duplicate POST.
      if (paymentReference) {
        const wcPreFlight = await findWcOrderByRef(paymentReference);
        if (wcPreFlight.status === "found") {
          logger.info(
            { paymentReference, wcAnchorId },
            "[orders] WC pre-flight: existing WC order found — skipping POST",
          );
          const normalized = normalizeOrder(wcPreFlight.order);
          if (wcAnchorId !== null) {
            const iConfirmed = await confirmWcAnchor(wcAnchorId);
            if (iConfirmed) {
              if (discountType === "referral" && promoCode && userEmail) {
                recordReferralConversion(promoCode, userEmail);
              }
              sendWcOrderNotifications(normalized, orderUserId);
            }
          }
          res.json(normalized);
          return;
        }
        if (wcPreFlight.status === "error") {
          // WC is unreachable — fail closed to prevent a duplicate POST.
          logger.warn(
            { paymentReference, wcAnchorId },
            "[orders] WC pre-flight: lookup failed — failing closed, client should retry",
          );
          res.status(503).json({ error: "Service temporarily unavailable, please retry", retryable: true });
          return;
        }
        // status: "not_found" — WC confirmed no existing order; safe to POST.
      }

      // ── Step 2: Call WooCommerce ─────────────────────────────────────────
      const orderPayload = {
        payment_method: paymentMethod,
        payment_method_title:
          paymentMethod === "mpesa" ? "M-Pesa" :
          paymentMethod === "stripe" ? "Credit Card (Stripe)" :
          paymentMethod === "paystack" ? "Paystack" : "Cash on Delivery",
        set_paid: isPaid,
        shipping: shippingAddress,
        line_items: lineItems.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
        meta_data: [
          { key: "payment_reference", value: paymentReference ?? "" },
          { key: "promo_code", value: promoCode ?? "" },
          { key: "discount_percent", value: String(discountPercent) },
        ],
        coupon_lines: discountPercent > 0 && promoCode ? [{ code: promoCode }] : [],
      };

      let wcOrder: Record<string, unknown> | null = null;
      try {
        const orderRes = await fetch(wcUrl("/orders"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderPayload),
        });
        const parsed: unknown = await orderRes.json();
        if (parsed && typeof parsed === "object" && "id" in parsed) {
          wcOrder = parsed as Record<string, unknown>;
        }
      } catch {
        // WC call threw — attempt reconciliation below.
      }

      // ── Step 3b: Reconcile when WC result is uncertain ───────────────────
      // Uses the targeted meta_key/meta_value query; secondary exact-match scan
      // guards against partial WC filtering.
      // Tri-state: "found" → use reconciled order; "not_found" or "error" →
      // keep anchor intact and return a retriable 503 — both states mean we
      // cannot safely confirm that WC did not create an order.
      if (!wcOrder && paymentReference) {
        const reconciled = await findWcOrderByRef(paymentReference);
        if (reconciled.status === "found") {
          wcOrder = reconciled.order;
        } else {
          logger.warn(
            { paymentReference, wcAnchorId, reconcileStatus: reconciled.status },
            "[orders] WC call failed; reconciliation inconclusive — anchor retained; client should retry",
          );
          res.status(503).json({ error: "Service temporarily unavailable, please retry", retryable: true });
          return;
        }
      }

      if (wcOrder) {
        // ── Step 3a: Atomic anchor confirmation ──────────────────────────
        // confirmWcAnchor uses UPDATE WHERE status='pending-wc'; only the
        // request that wins the transition (returns true) sends notifications.
        // Concurrent requests that lose skip notifications and return normally.
        const normalized = normalizeOrder(wcOrder);
        if (wcAnchorId !== null) {
          const iConfirmed = await confirmWcAnchor(wcAnchorId);
          if (iConfirmed) {
            if (discountType === "referral" && promoCode && userEmail) {
              recordReferralConversion(promoCode, userEmail);
            }
            sendWcOrderNotifications(normalized, orderUserId);
          }
        } else {
          // COD order (no payment reference → no anchor).  There is no
          // concurrent-request race for reference-less orders, so send
          // the confirmation unconditionally whenever WC accepts the order.
          if (discountType === "referral" && promoCode && userEmail) {
            recordReferralConversion(promoCode, userEmail);
          }
          sendWcOrderNotifications(normalized, orderUserId);
        }
        res.json(normalized);
        return;
      }
      // ── WC returned no usable order and reconciliation was skipped ────────
      // (paymentReference was empty / COD — fall through to DB path)
    }
  } catch { /* fall through to mock */ }

  // Persist order to DB
  try {
    const [dbOrder] = await db.insert(ucOrdersTable).values({
      userId:           orderUserId,
      status:           paymentMethod === "cod" ? "pending" : "processing",
      total:            String(netTotal),
      currency:         "KES",
      paymentMethod,
      paymentReference: paymentReference ?? "",
      promoCode:        promoCode ?? "",
      discountPercent,
      discountAmount,
      shippingAddress:  shippingAddress ?? {},
    }).returning();

    if (dbOrder && productLines.length > 0) {
      await db.insert(ucOrderItemsTable).values(
        productLines.map(({ productId, name, quantity, subtotal: t }) => ({
          orderId:   dbOrder.id,
          productId,
          name,
          quantity,
          total:     String(t),
        }))
      );
    }

    // Record referral conversion so the referrer earns credit
    if (discountType === "referral" && promoCode && userEmail) {
      recordReferralConversion(promoCode, userEmail);
    }

    const newOrder = {
      id:              dbOrder!.id,
      status:          dbOrder!.status,
      dateCreated:     dbOrder!.dateCreated,
      total:           dbOrder!.total,
      currency:        dbOrder!.currency,
      paymentMethod:   dbOrder!.paymentMethod,
      shippingAddress: dbOrder!.shippingAddress ?? {},
      discountPercent,
      discountAmount,
      promoCode:       promoCode ?? "",
      lineItems:       productLines.map(({ productId, name, quantity, subtotal: t }) => ({
        productId, name, quantity, total: String(t),
      })),
    };

    sendPushToUser(
      orderUserId,
      "✅ Order confirmed!",
      `Your order #${newOrder.id} is placed and being processed.`,
      { screen: "orders", orderId: String(newOrder.id) },
      "orders"
    );
    // SMS + email confirmations (fire-and-forget)
    sendOrderConfirmationEmail(orderUserId, {
      orderId:         newOrder.id,
      lineItems:       newOrder.lineItems,
      total:           newOrder.total,
      currency:        newOrder.currency,
      paymentMethod:   newOrder.paymentMethod,
      shippingAddress: newOrder.shippingAddress as Record<string, string> | undefined,
      discountAmount:  newOrder.discountAmount,
      promoCode:       newOrder.promoCode,
    });

    res.json(newOrder);
  } catch (dbErr) {
    // ── Unique-constraint violation (concurrent duplicate request) ────────────
    // Two requests can race through the pre-check and both try to insert.
    // The loser hits Postgres error 23505. Re-read the winner's row and return
    // it without sending any additional notification.
    // DrizzleQueryError wraps the underlying pg error in `.cause`; the Postgres
    // error code "23505" (unique_violation) is therefore at dbErr.cause.code,
    // not dbErr.code.  Check both so the handler fires whether the raw pg error
    // or a Drizzle-wrapped version reaches this catch block.
    const _pgErrCode =
      (dbErr as { code?: string }).code ??
      (dbErr as { cause?: { code?: string } }).cause?.code;
    if (paymentReference && _pgErrCode === "23505") {
      try {
        const [winner] = await db
          .select()
          .from(ucOrdersTable)
          .where(and(
            eq(ucOrdersTable.paymentReference, paymentReference),
            ne(ucOrdersTable.paymentReference, ""),
          ))
          .limit(1);
        if (winner) {
          logger.info(
            { orderId: winner.id },
            "[orders] unique-constraint race resolved — returning existing order without re-notifying",
          );
          const winnerItems = await db
            .select()
            .from(ucOrderItemsTable)
            .where(eq(ucOrderItemsTable.orderId, winner.id));
          res.json({
            id:              winner.id,
            status:          winner.status,
            dateCreated:     winner.dateCreated,
            total:           winner.total,
            currency:        winner.currency,
            paymentMethod:   winner.paymentMethod,
            shippingAddress: winner.shippingAddress ?? {},
            discountPercent: winner.discountPercent,
            discountAmount:  winner.discountAmount,
            promoCode:       winner.promoCode ?? "",
            lineItems:       winnerItems.map(i => ({
              productId: i.productId,
              name:      i.name,
              quantity:  i.quantity,
              total:     i.total,
            })),
          });
          return;
        }
      } catch (rerr) {
        logger.error({ err: rerr }, "[orders] failed to re-read order after unique-constraint conflict");
      }
    }

    // DB unavailable — fall back to in-memory so the order is not lost in the response
    console.error("[orders] DB insert failed, using fallback:", dbErr);
    const fallbackOrder = {
      id:          Date.now(),
      status:      paymentMethod === "cod" ? "pending" : "processing",
      dateCreated: new Date().toISOString(),
      total:       String(netTotal),
      currency:    "KES",
      userId:      orderUserId,
      lineItems:   productLines.map(({ productId, name, quantity, subtotal: t }) => ({
        productId, name, quantity, total: String(t),
      })),
      paymentMethod,
      shippingAddress: shippingAddress ?? {},
      discountPercent,
      discountAmount,
      promoCode:   promoCode ?? "",
    };
    orderStoreFallback.push(fallbackOrder);
    if (discountType === "referral" && promoCode && userEmail) {
      recordReferralConversion(promoCode, userEmail);
    }
    sendPushToUser(
      orderUserId,
      "✅ Order confirmed!",
      `Your order #${fallbackOrder.id} is placed and being processed.`,
      { screen: "orders", orderId: String(fallbackOrder.id) },
      "orders"
    );
    // SMS + email confirmations (fire-and-forget, fallback path)
    sendOrderConfirmationEmail(orderUserId, {
      orderId:         fallbackOrder.id,
      lineItems:       fallbackOrder.lineItems,
      total:           fallbackOrder.total,
      currency:        fallbackOrder.currency,
      paymentMethod:   fallbackOrder.paymentMethod,
      shippingAddress: fallbackOrder.shippingAddress as Record<string, string> | undefined,
      discountAmount:  fallbackOrder.discountAmount,
      promoCode:       fallbackOrder.promoCode,
    });
    res.json(fallbackOrder);
  }
});

// ─── Push notification endpoints ─────────────────────────────────────────────

/**
 * POST /api/uc/notify/register
 * Authenticated — stores the caller's Expo push token in the server-side map.
 * The token is keyed by the user ID extracted from the Bearer JWT, so only
 * the authenticated user's own token is ever registered here.
 */
router.post("/uc/notify/register", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFromBearer(req.headers["authorization"]);
  if (userId === "anonymous") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const notifyNumericId = Number(userId);
  if (await guardDeletedAccount(notifyNumericId, res)) return;
  const { pushToken } = req.body as { pushToken?: string };
  if (!pushToken) {
    res.status(400).json({ error: "pushToken required" });
    return;
  }
  try {
    // Check whether this user already has saved notification preferences so we
    // can carry them over into the push token row (handles the case where the
    // user opted out before granting push permission).
    const existingPrefs = await db.query.ucNotifPrefsTable
      .findFirst({ where: eq(ucNotifPrefsTable.userId, userId) })
      .catch(() => null);

    await db
      .insert(ucPushTokensTable)
      .values({
        userId,
        pushToken,
        optOutOrders: existingPrefs?.optOutOrders ?? false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: ucPushTokensTable.userId,
        set: {
          pushToken,
          // Preserve the opt-out flag from the prefs table if available; otherwise
          // keep whatever was already stored (don't reset an existing opt-out).
          ...(existingPrefs != null ? { optOutOrders: existingPrefs.optOutOrders } : {}),
          updatedAt: new Date(),
        },
      });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to register push token", detail: String(err) });
  }
});

/**
 * DELETE /api/uc/notify/register
 * Authenticated — removes the caller's registered push token so a logged-out
 * (or handed-over) device stops receiving that user's order-update pushes.
 *
 * Device-specific: when the body includes { pushToken }, the row is deleted
 * only if the stored token matches — so logging out on device A never wipes
 * a token that device B registered more recently. When no pushToken is sent
 * (legacy clients / token unavailable), the user's row is deleted regardless.
 * Idempotent: succeeds even when no token row exists.
 */
router.delete("/uc/notify/register", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFromBearer(req.headers["authorization"]);
  if (userId === "anonymous") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { pushToken } = (req.body ?? {}) as { pushToken?: string };
  try {
    const where = typeof pushToken === "string" && pushToken.length > 0
      ? and(eq(ucPushTokensTable.userId, userId), eq(ucPushTokensTable.pushToken, pushToken))
      : eq(ucPushTokensTable.userId, userId);
    await db.delete(ucPushTokensTable).where(where);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to unregister push token", detail: String(err) });
  }
});

/**
 * POST /api/uc/notify/prefs
 * Authenticated — upserts the caller's server-side notification opt-out flags.
 * Works even when no push token has been registered yet: prefs are stored in
 * uc_notif_prefs and synced into uc_push_tokens the next time a token is
 * registered, so user opt-outs are never silently lost.
 * Body: { optOutOrders?: boolean }
 */
router.post("/uc/notify/prefs", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFromBearer(req.headers["authorization"]);
  if (userId === "anonymous") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const prefsNumericId = Number(userId);
  if (await guardDeletedAccount(prefsNumericId, res)) return;
  const { optOutOrders } = req.body as { optOutOrders?: boolean };
  const value = optOutOrders ?? false;
  try {
    // Upsert into the dedicated prefs table — always works, even without a push token row.
    await db
      .insert(ucNotifPrefsTable)
      .values({ userId, optOutOrders: value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: ucNotifPrefsTable.userId,
        set: { optOutOrders: value, updatedAt: new Date() },
      });
    // Best-effort: also sync to the push token row if one exists so sendPushToUser
    // can use a single-table lookup.
    await db
      .update(ucPushTokensTable)
      .set({ optOutOrders: value })
      .where(eq(ucPushTokensTable.userId, userId));
    res.json({ ok: true, created: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update preferences", detail: String(err) });
  }
});

/**
 * POST /api/uc/notify
 * Authenticated — sends a push notification to the authenticated user's
 * registered device.  The server resolves the recipient token from the
 * registered store; clients never supply a raw destination token.
 *
 * Body: { title: string, body?: string, data?: object }
 */
router.post("/uc/notify", async (req: Request, res: Response): Promise<void> => {
  // Require authentication — no unauthenticated push relay
  const userId = userIdFromBearer(req.headers["authorization"]);
  if (userId === "anonymous") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const tokenRow = await getPushTokenRow(userId);
  if (!tokenRow) {
    res.status(404).json({ error: "No push token registered for this account" });
    return;
  }
  const token = tokenRow.pushToken;

  const { title, body, data } = req.body as {
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    const { staleToken } = await callExpoPushApi(token, title, body ?? "", data ?? {});
    if (staleToken) {
      await removePushToken(userId);
      res.status(410).json({ error: "Push token is no longer valid — device has unregistered" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Push notification failed", detail: String(err) });
  }
});

// ─── Enquiries ────────────────────────────────────────────────────────────────

// ─── Office notifications ─────────────────────────────────────────────────────

/** Official office inbox for all customer form submissions. */
const OFFICE_EMAIL  = "sales@ucfilters.com";
const SERVICE_EMAIL = "service@ucfilters.com";

/**
 * Append a form submission record to a local JSONL file as a durable backup.
 * One JSON object per line — safe to append concurrently. Fire-and-forget.
 */
async function appendToLocalStore(filename: string, record: Record<string, unknown>): Promise<void> {
  try {
    await appendFile(join(UC_DATA_DIR, filename), JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    console.error(`[local-store] append to ${filename} failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Send a plain-text notification to service@ucfilters.com — same delivery chain
 * as notifyOffice (Resend → SendGrid/SMTP fallback). Fire-and-forget; never throws.
 */
async function notifyService(subject: string, lines: string[], meta?: { testId?: string; ticketId?: string; orderId?: number | string }): Promise<void> {
  const text = lines.join("\n");
  const sent = await sendViaResend({
    from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
    to:   SERVICE_EMAIL,
    subject,
    text,
    meta: { template: "service_notification" },
  });
  if (sent) return;
  console.error(`[service-notify] Resend unavailable for "${subject}" — falling back`);
  sendEmail({
    to: SERVICE_EMAIL, subject, text,
    html: `<pre style="font-family:monospace">${escapeHtml(text)}</pre>`,
    template: "service_notification",
    testId:   meta?.testId,
    ticketId: meta?.ticketId,
    orderId:  meta?.orderId != null ? Number(meta.orderId) : undefined,
  }).catch(err =>
    console.error(`[service-notify] email failed for "${subject}":`, err instanceof Error ? err.message : err),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#x27;");
}

/**
 * Send a plain-text form-submission email to the office inbox (sales@ucfilters.com).
 * Prefers Resend (Replit connector, or direct API when RESEND_API_KEY /
 * RESEND_BASE_URL is set); falls back to the SendGrid/SMTP chain in lib/email
 * when Resend delivery fails. Fire-and-forget — never throws. Logs only the subject/request id,
 * never the form payload (it contains customer PII; the submission itself is
 * already persisted in the database).
 */
export async function notifyOffice(subject: string, lines: string[], meta?: { testId?: string; ticketId?: string; orderId?: number | string }): Promise<void> {
  const text = lines.join("\n");
  const sent = await sendViaResend({
    from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
    to: OFFICE_EMAIL,
    subject,
    text,
    meta: { template: "office_notification" },
  });
  if (sent) return;
  console.error(`[office-notify] Resend unavailable for "${subject}" — falling back to SendGrid/SMTP`);
  try {
    await sendEmail({
      to: OFFICE_EMAIL,
      subject,
      text,
      html: `<pre style="font-family:monospace">${escapeHtml(text)}</pre>`,
      template: "office_notification",
      testId:   meta?.testId,
      ticketId: meta?.ticketId,
      orderId:  meta?.orderId != null ? Number(meta.orderId) : undefined,
    });
  } catch (err) {
    console.error(`[office-notify] email failed for "${subject}":`, err instanceof Error ? err.message : err);
  }
}

/**
 * Send a plain-text notification email to info@ucfilters.com via Resend
 * (Replit connector or direct API). Fire-and-forget — the submission itself
 * is persisted in the database regardless of email delivery.
 */
async function sendEnquiryEmail(enquiry: {
  productName: string;
  name: string;
  email: string;
  phone: string;
  message: string;
}): Promise<void> {
  const sent = await sendViaResend({
    from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
    to: "info@ucfilters.com",
    subject: `New Enquiry: ${enquiry.productName}`,
    text: [
      `Product: ${enquiry.productName}`,
      `Name:    ${enquiry.name}`,
      `Email:   ${enquiry.email}`,
      `Phone:   ${enquiry.phone}`,
      "",
      enquiry.message,
    ].join("\n"),
    meta: { template: "product_enquiry" },
  });
  if (sent) return;
  console.error(`[enquiry] Resend unavailable for "${enquiry.productName}" — falling back to SendGrid/SMTP`);
  try {
    const text = [
      `Product: ${enquiry.productName}`,
      `Name:    ${enquiry.name}`,
      `Email:   ${enquiry.email}`,
      `Phone:   ${enquiry.phone}`,
      "",
      enquiry.message,
    ].join("\n");
    await sendEmail({
      to: "info@ucfilters.com",
      subject: `New Enquiry: ${enquiry.productName}`,
      text,
      html: `<pre style="font-family:monospace">${escapeHtml(text)}</pre>`,
      template: "product_enquiry",
    });
  } catch (err) {
    console.error(`[enquiry] email failed for "${enquiry.productName}":`, err instanceof Error ? err.message : err);
  }
}

/** In-memory fallback when the DB insert fails (e.g. table not yet created). */
const enquiryStoreFallback: Record<string, unknown>[] = [];

router.post("/uc/enquiries", async (req: Request, res: Response): Promise<void> => {
  const { productId, productName, name, email, phone, message } = req.body as {
    productId?: number;
    productName?: string;
    name?: string;
    email?: string;
    phone?: string;
    message?: string;
  };
  if (!productId || !productName || !name || !email || !phone || !message) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }

  const userId = userIdFromBearer(req.headers["authorization"]);
  // Reject deleted accounts — guest enquiries (userId === "anonymous") are allowed.
  if (userId !== "anonymous") {
    if (await guardDeletedAccount(Number(userId), res)) return;
  }

  try {
    await db.insert(ucEnquiriesTable).values({
      userId: userId === "anonymous" ? null : userId,
      productId: String(productId),
      productName,
      name,
      email,
      phone,
      message,
    });
  } catch {
    // DB not yet available — store in memory so we don't lose the lead
    enquiryStoreFallback.push({
      productId, productName, name, email, phone, message,
      createdAt: new Date().toISOString(),
    });
  }

  // Fire-and-forget email notification
  sendEnquiryEmail({ productName, name, email, phone, message }).catch(() => {});

  res.status(201).json({
    ok: true,
    message: "Enquiry received. We'll be in touch within 24 hours.",
  });
});

// ─── Locations ────────────────────────────────────────────────────────────────
router.get("/uc/locations", (_req: Request, res: Response): void => {
  res.json(MOCK_LOCATIONS);
});

// ─── Tickets ──────────────────────────────────────────────────────────────────
router.get("/uc/tickets", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFromBearer(req.headers["authorization"]);
  try {
    const tickets = await db.select().from(ucTicketsTable)
      .where(eq(ucTicketsTable.userId, userId))
      .orderBy(desc(ucTicketsTable.createdAt));
    res.json(tickets);
  } catch {
    res.json(ticketStoreFallback.filter(t => (t as Record<string,unknown>)["userId"] === userId));
  }
});

router.post("/uc/tickets", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFromBearer(req.headers["authorization"]);
  const ticketNumericId = Number(userId);
  if (await guardDeletedAccount(ticketNumericId, res)) return;
  const { productModel, issueDescription, preferredContactTime, photos, videos } = req.body as {
    productModel?: string;
    issueDescription?: string;
    preferredContactTime?: string;
    photos?: string[];
    videos?: string[];
  };
  if (!productModel || !issueDescription) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const photoList = sanitizeMediaUrls(photos, 6);
  const videoList = sanitizeMediaUrls(videos, 2);
  if (photoList === null || videoList === null) {
    res.status(400).json({ error: "Invalid attachment" });
    return;
  }
  const ticketMediaError = await verifyUploadedMediaItems([
    ...photoList.map((u) => ({ url: u, type: "photo" as const })),
    ...videoList.map((u) => ({ url: u, type: "video" as const })),
  ]);
  if (ticketMediaError) {
    res.status(400).json({ error: ticketMediaError });
    return;
  }
  const id = `TKT-${Date.now()}`;
  /** Build the notification lines for a ticket (shared between DB and fallback paths). */
  function tktNotifyLines(ticketId: string, customerStr: string): string[] {
    return [
      `Ticket:        ${ticketId}`,
      `Product(s):    ${productModel}`,
      `Issue:         ${issueDescription}`,
      `Contact time:  ${preferredContactTime ?? "Any time"}`,
      `Customer:      ${customerStr}`,
      ...(photoList!.length ? [`Photos:        ${photoList!.join(", ")}`] : []),
      ...(videoList!.length ? [`Videos:        ${videoList!.join(", ")}`] : []),
    ];
  }

  /** Fire all post-submission notifications for a ticket. */
  function dispatchTktNotifications(ticketId: string): void {
    getUserContact(userId).then(contact => {
      const customerStr = contact
        ? `${contact.firstName ?? ""} ${contact.email ?? ""} ${contact.phone ?? ""}`.trim()
        : "(guest)";
      const lines   = tktNotifyLines(ticketId, customerStr);
      const subject = `New Service Request ${ticketId}: ${productModel}`;

      if (contact?.phone) {
        sendSms(contact.phone, ticketConfirmationSms({ ticketId, firstName: contact.firstName }), { template: "ticket_confirmation", ticketId });
      }
      if (contact?.email) {
        const receipt = buildTicketConfirmationEmail({
          ticketId, firstName: contact.firstName, email: contact.email,
          productModel: productModel ?? "", issueDescription: issueDescription ?? "",
        });
        sendEmail({ to: contact.email, ...receipt, template: "ticket_confirmation", ticketId }).catch(() => {});
      }
      notifyOffice(subject, lines, { ticketId }).catch(() => {});
      notifyService(subject, [
        ...lines,
        "",
        `Service type:  Maintenance / Support Ticket`,
        `Ticket ref:    ${ticketId}`,
      ], { ticketId }).catch(() => {});
    }).catch(() => {});

    // Local JSONL backup regardless of login state
    appendToLocalStore("tickets.jsonl", {
      id: ticketId, userId, productModel, issueDescription,
      preferredContactTime: preferredContactTime ?? "Any time",
      photos: photoList, videos: videoList, submittedAt: new Date().toISOString(),
    });
  }

  try {
    const [ticket] = await db.insert(ucTicketsTable).values({
      id,
      userId,
      productModel,
      issueDescription,
      preferredContactTime: preferredContactTime ?? "Any time",
      photos: photoList,
      videos: videoList,
    }).returning();
    dispatchTktNotifications(ticket.id);
    res.status(201).json(ticket);
  } catch (err) {
    console.error("[tickets] DB insert failed, using fallback:", err);
    const fallback = {
      id, userId, productModel, issueDescription,
      preferredContactTime: preferredContactTime ?? "Any time",
      photos: photoList,
      videos: videoList,
      status: "submitted",
      createdAt: new Date().toISOString(),
    };
    ticketStoreFallback.push(fallback);
    dispatchTktNotifications(id);
    res.status(201).json(fallback);
  }
});

// ─── Water Tests ──────────────────────────────────────────────────────────────
router.post("/uc/water-tests", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFromBearer(req.headers["authorization"]);
  const wtNumericId = Number(userId);
  if (await guardDeletedAccount(wtNumericId, res)) return;
  const { name, address, phone, email: formEmail, waterSource, concerns, photos, videos } = req.body as {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    waterSource?: string;
    concerns?: string;
    photos?: string[];
    videos?: string[];
  };
  if (!name || !address || !phone) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const photoList = sanitizeMediaUrls(photos, 6);
  const videoList = sanitizeMediaUrls(videos, 2);
  if (photoList === null || videoList === null) {
    res.status(400).json({ error: "Invalid attachment" });
    return;
  }
  const wtMediaError = await verifyUploadedMediaItems([
    ...photoList.map((u) => ({ url: u, type: "photo" as const })),
    ...videoList.map((u) => ({ url: u, type: "video" as const })),
  ]);
  if (wtMediaError) {
    res.status(400).json({ error: wtMediaError });
    return;
  }
  const id = `WT-${Date.now()}`;
  const firstName = name.split(" ")[0] ?? name;

  /** Build the notification lines (shared between DB path and fallback path). */
  function wtNotifyLines(testId: string): string[] {
    return [
      `Request:      ${testId}`,
      `Name:         ${name}`,
      `Phone:        ${phone}`,
      ...(formEmail ? [`Email:        ${formEmail}`] : []),
      `Address:      ${address}`,
      `Water source: ${waterSource ?? "Municipal"}`,
      `Concerns:     ${concerns || "(none given)"}`,
      ...(photoList!.length ? [`Photos:       ${photoList!.join(", ")}`] : []),
      ...(videoList!.length ? [`Videos:       ${videoList!.join(", ")}`] : []),
    ];
  }

  /** Send all post-submission notifications (fire-and-forget). */
  function dispatchWtNotifications(testId: string): void {
    const lines = wtNotifyLines(testId);
    const subject = `New Water Test Request ${testId}: ${name}`;

    // SMS to the phone number given in the form
    sendSms(phone!, waterTestConfirmationSms({ testId, address: address!, firstName }), { template: "water_test_confirmation", testId });

    // Receipt email to submitted address (always, regardless of login)
    const emailTarget = formEmail?.trim() || null;
    if (emailTarget) {
      const receipt = buildWaterTestConfirmationEmail({
        testId, firstName, email: emailTarget,
        address: address!, waterSource: waterSource ?? "Municipal", concerns: concerns ?? "",
      });
      sendEmail({ to: emailTarget, ...receipt, template: "water_test_confirmation", testId }).catch(() => {});
    }

    // If logged in, also send to registered account email (may differ from form email)
    getUserContact(userId).then(contact => {
      if (contact?.email && contact.email !== emailTarget) {
        const receipt = buildWaterTestConfirmationEmail({
          testId, firstName: contact.firstName, email: contact.email,
          address: address!, waterSource: waterSource ?? "Municipal", concerns: concerns ?? "",
        });
        sendEmail({ to: contact.email, ...receipt, template: "water_test_confirmation", testId }).catch(() => {});
      }
    }).catch(() => {});

    // Full copy to sales@ucfilters.com (office) and service@ucfilters.com
    notifyOffice(subject, lines, { testId }).catch(() => {});
    notifyService(subject, [
      ...lines,
      "",
      `Service type: Water Quality Test`,
      `Ticket:       ${testId}`,
    ], { testId }).catch(() => {});

    // Local JSONL backup for retrieval without DB access
    appendToLocalStore("water-tests.jsonl", {
      id: testId, userId, name, phone, email: formEmail ?? null, address,
      waterSource: waterSource ?? "Municipal", concerns: concerns ?? "",
      photos: photoList, videos: videoList, submittedAt: new Date().toISOString(),
    });
  }

  try {
    const [wt] = await db.insert(ucWaterTestsTable).values({
      id, userId, name, address, phone,
      waterSource: waterSource ?? "Municipal",
      concerns:    concerns ?? "",
      photos:      photoList,
      videos:      videoList,
    }).returning();
    dispatchWtNotifications(wt.id);
    res.status(201).json(wt);
  } catch (err) {
    console.error("[water-tests] DB insert failed, using fallback:", err);
    const fallback = {
      id, userId, name, address, phone,
      waterSource: waterSource ?? "Municipal",
      concerns:    concerns ?? "",
      photos:      photoList,
      videos:      videoList,
      status:      "pending",
      createdAt:   new Date().toISOString(),
    };
    waterTestStoreFallback.push(fallback);
    dispatchWtNotifications(id);
    res.status(201).json(fallback);
  }
});

export default router;
