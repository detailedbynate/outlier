/**
 * Known games and topics for free, rule-based labeling. Each entry is one niche
 * entity: its proper name, the phrases people write for it (hashtags, short
 * forms), and its category. Matching is whole-word, so short aliases like "msm"
 * only count as their own token.
 */

import type { NicheCategory } from "./labeling";

export interface DictionaryEntry {
  name: string;
  kind: "game" | "topic";
  category: NicheCategory;
  aliases: string[];
  /** The platform a game lives inside (Blox Fruits is a Roblox game): it wins over the platform when both match. */
  within?: string;
  /** The name is an everyday word ("Rust", "Doors"), so only the aliases count as a match. */
  aliasesOnly?: boolean;
}

const game = (name: string, aliases: string[] = [], within?: string): DictionaryEntry => ({
  name,
  kind: "game",
  category: "Gaming",
  aliases,
  ...(within ? { within } : {}),
});

/** An entry whose name alone is too common to trust. */
const strict = (entry: DictionaryEntry): DictionaryEntry => ({ ...entry, aliasesOnly: true });

const topic =
  (category: NicheCategory) =>
  (name: string, aliases: string[] = []): DictionaryEntry => ({ name, kind: "topic", category, aliases });

const food = topic("Food & Cooking");
const fitness = topic("Fitness & Health");
const money = topic("Finance & Business");
const tech = topic("Science & Tech");
const learn = topic("Education & Explainers");
const beauty = topic("Beauty & Fashion");
const life = topic("Lifestyle & Vlogs");
const craft = topic("DIY, Crafts & Home");
const art = topic("Art & Animation");
const animals = topic("Animals & Pets");
const outdoors = topic("Travel & Outdoors");
const cars = topic("Cars & Vehicles");
const fun = topic("Entertainment & Pop Culture");
const comedy = topic("Comedy & Skits");
const music = topic("Music & Dance");
const sports = topic("Sports");
const self = topic("Motivation & Self-Improvement");
const social = topic("Relationships & Social");
const calm = topic("ASMR & Satisfying");

export const NICHE_DICTIONARY: DictionaryEntry[] = [
  // Mobile games
  game("Clash Royale", ["clashroyale", "clash royal"]),
  game("Clash of Clans", ["clashofclans", "coc"]),
  game("Brawl Stars", ["brawlstars"]),
  game("The Battle Cats", ["battle cats", "thebattlecats", "battlecats"]),
  game("My Singing Monsters", ["msm", "mysingingmonsters", "singing monsters", "wubbox"]),
  game("Subway Surfers", ["subwaysurfers"]),
  game("Geometry Dash", ["geometrydash", "gd"]),
  game("Royal Match", ["royalmatch"]),
  game("Squad Busters", ["squadbusters"]),
  game("Pokémon GO", ["pokemon go", "pokemongo"]),
  game("Monopoly GO", ["monopoly go", "monopolygo"]),
  game("Coin Master", ["coinmaster"]),
  game("Candy Crush", ["candycrush", "candy crush saga"]),
  game("Hill Climb Racing", ["hillclimbracing", "hill climb"]),
  game("Stumble Guys", ["stumbleguys"]),
  game("Among Us", ["amongus"]),
  game("Plants vs. Zombies", ["plants vs zombies", "pvz", "pvz fusion", "plantsvszombies"]),
  game("Cookie Run: Kingdom", ["cookie run", "cookie run kingdom", "cookierun", "crk"]),
  game("Honkai: Star Rail", ["honkai star rail", "hsr", "starrail"]),
  game("Genshin Impact", ["genshin", "genshinimpact"]),
  game("Wuthering Waves", ["wuwa", "wutheringwaves"]),
  game("Zenless Zone Zero", ["zenless"]),
  game("Free Fire", ["freefire", "garena free fire"]),
  game("PUBG Mobile", ["pubg", "pubgm", "bgmi"]),
  game("Call of Duty: Mobile", ["cod mobile", "codm"]),
  game("Mobile Legends", ["mlbb", "mobile legends bang bang"]),
  game("Block Blast", ["blockblast"]),
  game("Chess", ["chess com", "chesscom", "lichess"]),
  // Roblox
  game("Roblox", ["robloxedit", "robloxfyp"]),
  game("Blox Fruits", ["bloxfruits", "blox fruit"], "Roblox"),
  strict(game("Doors", ["doors roblox", "roblox doors", "doors hotel", "doors floor 2"], "Roblox")),
  game("Grow a Garden", ["grow a garden", "growagarden"], "Roblox"),
  game("Dead Rails", ["deadrails"], "Roblox"),
  game("Adopt Me", ["adoptme", "adopt me roblox"], "Roblox"),
  game("Brookhaven", ["brookhaven rp"], "Roblox"),
  game("Pet Simulator 99", ["pet simulator", "ps99", "petsim"], "Roblox"),
  game("BedWars", ["roblox bedwars", "bedwars"], "Roblox"),
  game("Blade Ball", ["bladeball"], "Roblox"),
  game("The Strongest Battlegrounds", ["strongest battlegrounds", "tsb"], "Roblox"),
  game("Murder Mystery 2", ["mm2", "murder mystery"], "Roblox"),
  // Minecraft and sandbox
  game("Minecraft", ["minecraftmemes", "mcpe"]),
  game("Terraria", []),
  game("Stardew Valley", ["stardew"]),
  game("Garry's Mod", ["garrys mod", "gmod"]),
  game("Lethal Company", ["lethalcompany"]),
  strict(game("Content Warning", ["content warning game"])),
  game("R.E.P.O.", ["repo game"]),
  // Console and PC
  game("Fortnite", ["fortnitebr", "fortnite zero build", "zero build"]),
  game("Valorant", ["valo"]),
  game("Counter-Strike 2", ["counter strike", "cs2", "csgo", "cs go"]),
  game("Apex Legends", ["apexlegends"]),
  game("Overwatch 2", ["overwatch", "ow2"]),
  game("Marvel Rivals", ["marvelrivals"]),
  game("Rainbow Six Siege", ["r6", "r6s", "rainbow six"]),
  game("Call of Duty", ["warzone", "black ops", "modern warfare", "cod warzone"]),
  game("GTA V", ["gta 5", "gta v", "gta5", "gta online"]),
  game("GTA VI", ["gta 6", "gta vi", "gta6"]),
  game("Red Dead Redemption 2", ["rdr2", "red dead"]),
  game("Elden Ring", ["eldenring", "nightreign"]),
  game("Dark Souls", ["darksouls"]),
  game("Hollow Knight", ["hollowknight", "silksong"]),
  game("Baldur's Gate 3", ["baldurs gate 3", "bg3"]),
  game("Cyberpunk 2077", ["cyberpunk"]),
  game("Skyrim", ["elder scrolls"]),
  game("Fallout", ["fallout 4", "fallout 76", "fallout new vegas"]),
  game("The Sims 4", ["sims 4", "the sims", "sims4"]),
  game("Cities: Skylines", ["cities skylines"]),
  game("Factorio", []),
  strict(game("Satisfactory", ["satisfactory game", "satisfactory factory"])),
  game("RimWorld", ["rimworld"]),
  game("Subnautica", []),
  game("No Man's Sky", ["no mans sky", "nms"]),
  game("Helldivers 2", ["helldivers"]),
  game("Sea of Thieves", ["seaofthieves"]),
  strict(game("Rust", ["rust game", "playrust", "rust pvp", "rust base"])),
  game("DayZ", ["dayz"]),
  game("ARK: Survival", ["ark survival", "ark survival evolved", "ark ascended"]),
  game("Palworld", []),
  game("Pokémon", ["pokemon", "pokemon scarlet", "pokemon violet", "shiny pokemon", "nuzlocke"]),
  game("Pokémon TCG", ["pokemon cards", "pokemon tcg", "pokemon card", "pokemon pack opening"]),
  game("The Legend of Zelda", ["zelda", "tears of the kingdom", "totk", "breath of the wild", "botw"]),
  game("Super Mario", ["mario", "mario kart", "super mario bros"]),
  game("Super Smash Bros.", ["smash bros", "ssbu", "smash ultimate"]),
  game("Animal Crossing", ["acnh", "animalcrossing"]),
  game("Rocket League", ["rocketleague"]),
  game("EA Sports FC", ["ea fc", "fc 25", "fc 26", "fifa", "ultimate team", "fut"]),
  game("NBA 2K", ["2k25", "2k26", "nba2k"]),
  game("Madden NFL", ["madden"]),
  game("MLB The Show", ["mlb the show"]),
  game("League of Legends", ["leagueoflegends"]),
  game("Dota 2", ["dota"]),
  game("Teamfight Tactics", ["tft"]),
  game("Hearthstone", []),
  game("World of Warcraft", ["warcraft", "worldofwarcraft"]),
  game("Old School RuneScape", ["osrs", "runescape"]),
  game("Path of Exile 2", ["path of exile", "poe2"]),
  game("Diablo IV", ["diablo 4", "diablo"]),
  game("Destiny 2", ["destiny2"]),
  strict(game("The Finals", ["thefinals", "the finals game"])),
  game("Phasmophobia", ["phasmo"]),
  game("Five Nights at Freddy's", ["fnaf", "five nights at freddys"]),
  game("Undertale", []),
  game("Deltarune", []),
  game("Celeste", []),
  game("Balatro", []),
  strict(game("Schedule I", ["schedule 1 game", "schedule i game"])),
  game("Euro Truck Simulator 2", ["euro truck simulator", "ets2"]),
  game("Microsoft Flight Simulator", ["flight simulator", "msfs"]),
  game("Speedrunning", ["speedrun", "speedrunner"]),
  game("Retro Gaming", ["retro games", "game boy", "gameboy", "n64", "ps1"]),

  // Food
  food("Air Fryer Cooking", ["air fryer", "airfryer"]),
  food("Meal Prep", ["mealprep"]),
  food("Sourdough Baking", ["sourdough"]),
  food("High-Protein Recipes", ["high protein", "protein recipes"]),
  food("Street Food", ["streetfood"]),
  food("Budget Meals", ["cheap meals", "budget cooking"]),
  food("Baking", ["cake decorating", "cookies recipe"]),
  food("BBQ & Smoking", ["bbq", "smoked brisket", "smoker"]),
  food("Coffee", ["espresso", "latte art"]),
  // Fitness
  fitness("Calisthenics", []),
  fitness("Home Workouts", ["home workout", "no equipment workout"]),
  strict(fitness("Running", ["marathon training", "running tips", "running form", "5k", "half marathon"])),
  fitness("Powerlifting", ["deadlift", "bench press"]),
  fitness("Bodybuilding", ["gym motivation", "hypertrophy"]),
  fitness("Yoga", []),
  fitness("Pilates", []),
  fitness("Weight Loss", ["fat loss", "weight loss journey"]),
  fitness("Boxing", ["boxing training"]),
  // Money
  money("Personal Finance", ["budgeting", "money tips"]),
  money("Investing", ["stocks", "stock market", "index funds"]),
  money("Side Hustles", ["side hustle", "make money online"]),
  money("Real Estate", ["real estate investing"]),
  money("Dropshipping", ["shopify"]),
  money("Day Trading", ["daytrading", "forex", "options trading"]),
  money("Crypto", ["bitcoin", "cryptocurrency"]),
  // Tech
  tech("iPhone Tips", ["iphone tricks", "ios tips"]),
  tech("PC Building", ["pc build", "gaming pc"]),
  tech("AI Tools", ["chatgpt", "artificial intelligence"]),
  tech("Coding", ["programming", "javascript", "python tutorial"]),
  tech("Tech Reviews", ["unboxing"]),
  tech("3D Printing", ["3d printer", "3d printed"]),
  strict(tech("Space", ["nasa", "astronomy", "spacex", "space facts", "black hole"])),
  // Education
  strict(learn("History", ["history facts", "ancient history", "historical", "medieval"])),
  learn("Psychology Facts", ["psychology"]),
  learn("Language Learning", ["learn spanish", "learn english", "learn japanese"]),
  learn("Math", ["math tricks", "maths"]),
  learn("Geography", ["geography facts"]),
  learn("True Crime", ["truecrime", "unsolved", "cold case", "murder case", "serial killer", "missing person", "crime story", "crimestory", "crime news", "crimenews", "court case", "courtroom", "trial footage"]),
  learn("Science Experiments", ["science experiment", "chemistry"]),
  learn("Book Summaries", ["book summary", "booktube"]),
  // Beauty and fashion
  beauty("Skincare", ["skin care"]),
  beauty("Makeup", ["makeup tutorial", "grwm"]),
  beauty("Men's Fashion", ["mens fashion", "menswear"]),
  beauty("Thrifting", ["thrift", "thrift haul"]),
  beauty("Hairstyles", ["hair tutorial", "haircut"]),
  // Lifestyle
  life("Productivity", ["productivity tips"]),
  life("Minimalism", []),
  life("Van Life", ["vanlife"]),
  life("Cleaning", ["cleaning motivation", "cleantok"]),
  life("Organization", ["organizing", "organization hacks"]),
  life("Day in the Life", ["day in my life", "a day in the life"]),
  // Crafts and home
  craft("Woodworking", []),
  craft("Pottery", ["ceramics", "wheel throwing"]),
  craft("Sewing", []),
  craft("Crochet", ["knitting"]),
  craft("LEGO", ["lego build", "lego builds"]),
  craft("Plant Care", ["houseplants", "gardening"]),
  craft("Home Renovation", ["renovation", "home improvement"]),
  // Art
  art("Digital Art", ["procreate", "digital painting"]),
  art("Drawing", ["drawing tutorial", "sketchbook"]),
  art("Animation", ["animator", "animated short"]),
  art("Photography", ["photography tips"]),
  art("Video Editing", ["premiere pro", "after effects", "capcut"]),
  // Animals
  animals("Dog Training", ["dog tricks", "puppy training"]),
  animals("Cats", ["cat videos", "funny cats"]),
  animals("Reptiles", ["gecko", "ball python", "bearded dragon"]),
  animals("Aquariums", ["aquarium", "fish tank"]),
  animals("Horses", ["equestrian"]),
  // Outdoors
  outdoors("Fishing", ["bass fishing"]),
  outdoors("Camping", ["bushcraft"]),
  strict(outdoors("Hunting", ["deer hunting", "duck hunting", "hunting season", "elk hunting"])),
  outdoors("Hiking", []),
  outdoors("Budget Travel", ["travel tips", "travel vlog"]),
  // Cars
  cars("Car Detailing", ["detailing", "ceramic coating"]),
  cars("Car Restoration", ["restoration", "barn find", "rust repair", "rust removal", "floor pans", "project car"]),
  cars("Motorcycles", ["motorcycle", "motovlog"]),
  cars("Off-Roading", ["offroad", "off road"]),
  cars("Electric Cars", ["tesla", "electric car"]),
  cars("Supercars", ["lamborghini", "ferrari"]),
  // Entertainment
  fun("Movies Explained", ["movie explained", "movie recap", "film theory"]),
  fun("Anime", ["manga", "one piece", "naruto", "jujutsu kaisen", "demon slayer"]),
  fun("Marvel & DC", ["marvel", "mcu", "dc comics", "batman"]),
  fun("Reddit Stories", ["reddit stories", "aita", "reddit story"]),
  fun("Celebrity News", ["celebrity", "hollywood"]),
  fun("Magic Tricks", ["magic trick", "magician"]),
  comedy("Skits", ["skit", "comedy skit"]),
  comedy("Pranks", ["prank"]),
  comedy("Stand-Up Comedy", ["stand up comedy", "standup"]),
  // Music
  music("Music Production", ["beatmaking", "fl studio", "ableton"]),
  music("Guitar", ["guitar lesson", "guitar cover"]),
  strict(music("Singing", ["vocal coach", "singing tips", "singing lesson", "vocal range"])),
  music("Dance", ["dance tutorial", "choreography"]),
  music("Piano", ["piano tutorial", "piano cover"]),
  // Sports
  sports("Basketball", ["nba", "basketball training"]),
  sports("Soccer", ["football skills", "premier league", "soccer skills"]),
  sports("Golf", ["golf tips", "golf swing"]),
  sports("Skateboarding", ["skate", "skateboard"]),
  sports("MMA & UFC", ["ufc", "mma"]),
  sports("Wrestling", ["wwe"]),
  sports("Formula 1", ["f1", "formula one"]),
  sports("Sports Cards", ["card breaks", "sports card"]),
  // Self-improvement and relationships
  self("Motivation", ["motivational"]),
  self("Stoicism", ["stoic"]),
  self("Self-Improvement", ["self improvement"]),
  social("Dating Advice", ["dating tips", "relationship advice"]),
  social("Parenting", ["mom life", "dad life"]),
  // Calm
  calm("ASMR", []),
  calm("Satisfying Videos", ["oddly satisfying", "satisfying"]),
];
