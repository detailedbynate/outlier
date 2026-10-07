/**
 * Keywords the library-growth job works through so the catalog covers far more
 * than what users happen to search. Games get the most room: that's where
 * underrated niches turn over fastest. Order within a group doesn't matter; the
 * job picks whatever the library is thinnest on.
 */

export const GAME_SEEDS = [
  // Mobile
  "clash royale", "clash of clans", "brawl stars", "my singing monsters", "subway surfers", "geometry dash", "royal match", "squad busters",
  "pokemon go", "monopoly go", "coin master", "candy crush", "hill climb racing", "stumble guys", "among us", "pvz fusion", "plants vs zombies",
  "cookie run kingdom", "honkai star rail", "genshin impact", "wuthering waves", "zenless zone zero", "arknights", "blue archive",
  "free fire", "pubg mobile", "call of duty mobile", "mobile legends", "eggy party", "block blast", "wordle", "chess com",
  // Roblox and sandbox
  "roblox", "blox fruits", "doors roblox", "grow a garden roblox", "dead rails roblox", "adopt me", "brookhaven", "pet simulator 99", "bedwars roblox",
  "minecraft", "minecraft hardcore", "minecraft mods", "minecraft building", "terraria", "stardew valley", "garrys mod", "lethal company",
  // Console and PC
  "fortnite", "fortnite zero build", "valorant", "counter strike 2", "apex legends", "overwatch 2", "marvel rivals", "rainbow six siege",
  "call of duty warzone", "gta 5", "gta 6", "red dead redemption 2", "elden ring", "dark souls", "hollow knight", "silksong", "baldurs gate 3",
  "cyberpunk 2077", "skyrim", "fallout 4", "the sims 4", "cities skylines", "factorio", "satisfactory", "rimworld", "subnautica", "no mans sky",
  "helldivers 2", "sea of thieves", "rust game", "dayz", "ark survival", "palworld", "pokemon scarlet", "pokemon cards", "zelda tears of the kingdom",
  "super mario", "smash bros", "animal crossing", "rocket league", "fifa ultimate team", "ea fc", "nba 2k", "madden", "mlb the show",
  "league of legends", "dota 2", "teamfight tactics", "hearthstone", "world of warcraft", "old school runescape", "path of exile 2", "diablo 4",
  "destiny 2", "the finals", "deadlock valve", "phasmophobia", "five nights at freddys", "undertale", "deltarune", "celeste speedrun", "speedrunning",
  "retro gaming", "game boy", "indie horror games", "cozy games", "roguelike games", "vr games", "flight simulator", "euro truck simulator",
] as const;

export const TOPIC_SEEDS = [
  // Food
  "air fryer recipes", "meal prep", "sourdough", "high protein recipes", "street food", "budget meals", "baking", "bbq smoking", "coffee",
  // Fitness and health
  "calisthenics", "home workouts", "running", "powerlifting", "yoga", "pilates", "weight loss journey", "mobility stretching", "boxing training",
  // Money and business
  "personal finance", "investing for beginners", "side hustles", "real estate investing", "dropshipping", "amazon fba", "day trading", "credit cards",
  "small business", "freelancing", "sales tips",
  // Tech
  "iphone tips", "pc building", "ai tools", "coding", "tech reviews", "smart home", "cybersecurity", "linux", "3d printing",
  // Education
  "history facts", "space facts", "psychology facts", "language learning", "math tricks", "geography", "true crime", "cold cases", "crime news",
  "courtroom", "unsolved mysteries", "serial killers", "missing persons", "science experiments",
  "philosophy", "book summaries", "study tips",
  // Lifestyle and style
  "skincare", "makeup tutorial", "mens fashion", "thrifting", "minimalism", "productivity", "morning routine", "van life", "tiny homes",
  "cleaning motivation", "organization hacks", "plant care",
  // Creative
  "digital art", "drawing tutorial", "animation", "photography tips", "video editing", "woodworking", "pottery", "sewing", "crochet", "lego builds",
  // Outdoors, animals, cars
  "fishing", "camping", "hunting", "hiking", "dog training", "cat videos", "reptiles", "aquarium", "horses", "car detailing", "car restoration",
  "motorcycles", "offroad", "electric cars",
  // Entertainment
  "movie explained", "anime", "manga", "comics", "stand up comedy", "skits", "pranks", "magic tricks", "asmr", "satisfying videos", "storytime",
  "reddit stories", "celebrity news", "music production", "guitar lessons", "singing", "dance tutorial",
  // Sports
  "basketball training", "soccer skills", "golf tips", "tennis", "skateboarding", "surfing", "mma", "wrestling", "f1", "sports cards",
  // Relationships and self
  "dating advice", "parenting", "motivation", "stoicism", "self improvement", "public speaking", "mental health",
] as const;

/**
 * Niches where a view pays the most (finance, business, software, explainers).
 * They go first so Discover has high-RPM niches to rank, not just games.
 */
export const HIGH_RPM_SEEDS = [
  "personal finance tips", "budgeting", "credit score", "credit card rewards", "stock market news", "dividend investing", "index funds",
  "retirement planning", "taxes explained", "insurance explained", "mortgage tips", "crypto news", "real estate tips", "house flipping",
  "make money online", "business ideas", "entrepreneur", "ecommerce", "marketing tips", "sales tips", "saas", "startup",
  "ai news", "chatgpt tips", "ai side hustle", "software tutorial", "excel tips", "productivity apps", "tech news", "cybersecurity tips",
  "legal advice", "lawyer explains", "economics explained", "history explained", "psychology explained", "luxury watches", "car buying tips",
] as const;

export const LIBRARY_SEEDS: readonly string[] = [...new Set([...HIGH_RPM_SEEDS, ...GAME_SEEDS, ...TOPIC_SEEDS])];

/**
 * Radar-only starting points: specific, mostly faceless sub-niches where views
 * pay well. Autocomplete is cheap enough to comb all of them; library growth
 * keeps to the shorter lists above because its searches cost more.
 */
export const RADAR_SEEDS = [
  // Personal finance
  "roth ira", "401k", "hsa account", "high yield savings", "credit card churning", "balance transfer", "debt payoff", "student loans",
  "car insurance", "life insurance", "home insurance", "health insurance", "first time home buyer", "refinance", "heloc", "rental property",
  "property management", "airbnb hosting", "reits", "treasury bills", "options trading", "covered calls", "passive income", "fire movement",
  "frugal living", "tax deductions", "small business taxes", "llc", "bookkeeping", "estate planning", "wills and trusts", "social security",
  "medicare", "annuities", "credit repair", "identity theft", "points and miles", "airline miles",
  // Business and careers
  "email marketing", "seo", "google ads", "facebook ads", "affiliate marketing", "print on demand", "etsy shop", "shopify", "amazon kdp",
  "digital products", "cold email", "lead generation", "copywriting", "personal branding", "linkedin tips", "resume tips",
  "job interview tips", "salary negotiation", "remote jobs", "it career", "comptia",
  // Software and AI
  "excel formulas", "google sheets", "power bi", "sql tutorial", "python automation", "no code", "zapier", "notion", "obsidian",
  "canva tutorial", "photoshop tutorial", "davinci resolve", "premiere pro", "wordpress", "web hosting", "vpn", "password manager",
  "home network", "windows tips", "mac tips", "android tips", "chrome extensions", "ai image generator", "ai video", "chatgpt prompts",
  "claude ai", "local llm", "ai agents", "aws",
  // Law and health
  "tenant rights", "small claims court", "immigration law", "medical billing", "nursing", "sleep science", "nutrition science",
  "supplements", "gut health", "blood sugar", "longevity", "dermatologist", "physical therapy", "back pain",
  // Home and cars
  "home renovation", "hvac", "plumbing repair", "electrical diy", "roofing", "solar panels", "heat pump", "lawn care", "pest control",
  "home security", "car maintenance", "ev charging", "used cars",
  // Explainers
  "geopolitics", "supply chain", "military history", "ancient history", "architecture", "engineering explained", "how it's made",
  "aviation", "trucking industry", "housing market",
  // Travel and pets
  "travel hacks", "cruise tips", "budget travel", "digital nomad", "moving abroad", "pet insurance", "dog food",
] as const;
