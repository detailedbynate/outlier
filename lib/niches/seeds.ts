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
  "history facts", "space facts", "psychology facts", "language learning", "math tricks", "geography", "true crime", "science experiments",
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

export const LIBRARY_SEEDS: readonly string[] = [...GAME_SEEDS, ...TOPIC_SEEDS];
