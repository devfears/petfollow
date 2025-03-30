/**
 * HYTOPIA SDK Boilerplate
 * 
 * This is a simple boilerplate to get started on your project.
 * It implements the bare minimum to be able to run and connect
 * to your game server and run around as the basic player entity.
 * 
 * From here you can begin to implement your own game logic
 * or do whatever you want!
 * 
 * You can find documentation here: https://github.com/hytopiagg/sdk/blob/main/docs/server.md
 * 
 * For more in-depth examples, check out the examples folder in the SDK, or you
 * can find it directly on GitHub: https://github.com/hytopiagg/sdk/tree/main/examples/payload-game
 * 
 * You can officially report bugs or request features here: https://github.com/hytopiagg/sdk/issues
 * 
 * To get help, have found a bug, or want to chat with
 * other HYTOPIA devs, join our Discord server:
 * https://discord.gg/DXCXJbHSJX
 * 
 * Official SDK Github repo: https://github.com/hytopiagg/sdk
 * Official SDK NPM Package: https://www.npmjs.com/package/hytopia
 */

import {
  startServer,
  Audio,
  PlayerEntity,
  PlayerEvent,
  Entity,
  Vector3,
  EntityEvent,
  BaseEntityControllerEvent,
  ColliderShape,
  PersistenceManager,
  SceneUI,
  Block,
  PlayerUIEvent,
  RigidBodyType,
  Player,
  Quaternion,
  type Vector3Like,
  CollisionGroup,
  // World should NOT be listed here
} from 'hytopia';
// Use type imports for World, PlayerInput, PlayerCameraOrientation
import type { World, PlayerInput, PlayerCameraOrientation } from 'hytopia';

// import { SceneUI } from 'hytopia/client'; // Keep client types separate <-- REMOVED THIS LINE
import terrainMap from './assets/maps/terrain.json'; // Import the new map

// REMOVED duplicate type import for World

// Define a custom type to track which animals follow the player
interface PetFollowState {
  isFollowing: boolean;
  targetPlayerId: string | null;
  targetEntity: PlayerEntity | null;
}

// Define the distance threshold for showing the egg prompt
const EGG_PROMPT_DISTANCE = 2.5; 

// --- ADDED: Map to track the currently visible prompt type per player ---
// Stores the EggType (or null) currently displayed for each player ID
const playerVisiblePrompt: Map<string, EggType | null> = new Map();

// Helper function to convert numerical RigidBody types from JSON to enum members
const processMapData = (mapData: any): any => {
  if (mapData && typeof mapData === 'object' && mapData.entities) {
    for (const key in mapData.entities) {
      if (Object.prototype.hasOwnProperty.call(mapData.entities, key)) {
        const entityOptions = mapData.entities[key];
        if (entityOptions.rigidBodyOptions && typeof entityOptions.rigidBodyOptions.type === 'number') {
          const numericType = entityOptions.rigidBodyOptions.type;
          switch (numericType) {
            case 0: entityOptions.rigidBodyOptions.type = RigidBodyType.DYNAMIC; break;
            case 1: entityOptions.rigidBodyOptions.type = RigidBodyType.FIXED; break;
            case 2: entityOptions.rigidBodyOptions.type = RigidBodyType.KINEMATIC_POSITION; break;
            case 3: entityOptions.rigidBodyOptions.type = RigidBodyType.KINEMATIC_VELOCITY; break;
            default:
              console.warn(`Unknown numeric rigid body type ${numericType} found in map data for entity at ${key}. Keeping original value.`);
          }
        }
      }
    }
  }
  return mapData; // Return the processed (or original if no entities) map data
};

// --- ADDED: Collision Groups Definition ---
const COLLISION_GROUP_PLAYERS = CollisionGroup.GROUP_1;
const COLLISION_GROUP_PETS    = CollisionGroup.GROUP_2;
// --- END ADDED ---

// Create a map to track which pets are following which players
const petFollowStates = new Map<Entity, PetFollowState>();

// --- ADDED: Map to track entity IDs to their persistent IDs ---
const entityIdToPersistentIdMap = new Map<number, string>();
// --- END ADDED ---

// Add a Map to store session pets for each player
const playerSessionPets = new Map<string, Array<{ type: string, persistentId: string, rarity: EggType }>>();

/**
 * startServer is always the entry point for our game.
 * It accepts a single function where we should do any
 * setup necessary for our game. The init function is
 * passed a World instance which is the default
 * world created by the game server on startup.
 * 
 * Documentation: https://github.com/hytopiagg/sdk/blob/main/docs/server.startserver.md
 */

startServer((world: World) => {
  // Disable debug rendering to improve performance
  // world.simulation.enableDebugRendering(true);
  
  /**
   * Load our map.
   * You can build your own map using https://build.hytopia.com
   * After building, hit export and drop the .json file in
   * the assets folder as map.json.
   */
  const processedMap = processMapData(terrainMap); // Process the map data first
  world.loadMap(processedMap); // Load the processed map
  // Removed world.uiManager.register for egg-prompt

  // Place a gold block (ID 41) at specific coordinates
  // Commenting this out to prevent BlockType 41 error since map loading is disabled
  // world.chunkLattice.setBlock({ x: -12, y: 5, z: 16 }, 41); 

  // --- Set Nighttime Lighting --- 
  /* // <-- Commented out block
  console.log("Setting nighttime lighting...");
  // Dim directional light (moonlight)
  world.setDirectionalLightColor({ r: 100, g: 100, b: 150 }); // Cool blueish tint
  world.setDirectionalLightIntensity(0.15); // Quite dim
  world.setDirectionalLightPosition({ x: 0, y: 100, z: 50 }); // High up, slightly angled
  // Very dim ambient light
  world.setAmbientLightColor({ r: 50, g: 50, b: 80 }); // Dark blue ambient
  world.setAmbientLightIntensity(0.1); // Very dim
  console.log("Nighttime lighting set.");
  */ // <-- End commented out block

  // --- Set Nighttime Skybox --- 
  // NOTE: The exact URI 'skybox/night' might need verification based on available assets.
  // This assumes a standard nighttime skybox is available at this path.
  // world.setSkybox('skybox/night'); // <-- Removed incorrect call
  // console.log("Nighttime skybox set."); // <-- Removed related log

  // --- ADDED: Start Background Music --- 
  const backgroundMusic = new Audio({
    uri: 'audio/music/hytopia-main.mp3', // Path relative to assets folder
    // isAmbient: true, // REMOVED: Audio is ambient by default if not spatialized
    volume: 0.3, // Adjust volume (0.0 to 1.0)
    loop: true, // Make the music loop indefinitely
  });
  // Play the music using the world's audio manager
  backgroundMusic.play(world);
  console.log("Attempting to play background music: audio/music/hytopia-main.mp3"); // Debug log
  // --- END ADDED: Start Background Music ---

  // Store all player entities for reference
  const playerEntities: Map<string, PlayerEntity> = new Map();

  // --- ADDED: Counter for Basic Egg Hatch Sequence ---
  // let basicEggHatchSequence = 0; // 0 = Rabbit, 1 = Pig, 2 = Chicken
  // const BASIC_EGG_SEQUENCE_LENGTH = 3; // Number of pets in the sequence
  // --- END ADDED ---

  // Track the 'E' key press state for each player to detect single presses
  const playerEPressedState: Map<string, boolean> = new Map();
  
  // Store a reference to the leaderboard Scene UI
  let leaderboardSceneUI: SceneUI | null = null;
  
  // --- Leaderboard System ---
  interface LeaderboardEntry {
    playerId: string;
    name: string;
    score: number;
  }
  
  // Track player scores
  const playerScores: Map<string, number> = new Map();
  // Array of leaderboard entries sorted by score
  let leaderboardData: LeaderboardEntry[] = [];
  
  // Function to update a player's score
  const updatePlayerScore = (playerId: string, score: number) => {
    const playerEntity = playerEntities.get(playerId);
    if (!playerEntity) return;
    
    const username = playerEntity.player.username;
    playerScores.set(playerId, score);
    
    // Update the leaderboard data
    updateLeaderboard();
  };
  
  // Function to update the leaderboard ranking
  const updateLeaderboard = () => {
    // --- LOGGING: Leaderboard Update Start --- 
    // console.log(`[Leaderboard] Updating leaderboard...`); // <<< COMMENTED OUT
    // Create entries from player scores
    const entries: LeaderboardEntry[] = [];
    
    for (const [playerId, score] of playerScores.entries()) {
      const playerEntity = playerEntities.get(playerId);
      if (playerEntity) {
        entries.push({
          playerId,
          name: playerEntity.player.username,
          score
        });
      } else {
        // --- LOGGING: Player entity not found for score --- 
        console.warn(`[Leaderboard] Player entity not found for ID ${playerId} in playerScores.`);
      }
    }
    
    // --- LOGGING: Leaderboard Entries Before Sort --- 
    // console.log(`[Leaderboard] Entries before sort:`, JSON.stringify(entries)); // Can be verbose
    
    // Sort by score in descending order
    entries.sort((a, b) => b.score - a.score);
    
    // Update the leaderboard data
    leaderboardData = entries;
    
    // --- LOGGING: Leaderboard Data After Sort --- 
    // console.log(`[Leaderboard] Data after sort:`, JSON.stringify(leaderboardData)); // <<< COMMENTED OUT
    
    // Send updated leaderboard to all connected players
    for (const playerEntity of playerEntities.values()) {
      // --- LOGGING: Sending Leaderboard to Player --- 
      // console.log(`[Leaderboard] Sending update to ${playerEntity.player.username}`); // Can be verbose
      playerEntity.player.ui.sendData({
        type: 'updateLeaderboard',
        leaderboard: leaderboardData
      });
    }
    // --- LOGGING: Leaderboard Update End --- 
    // console.log(`[Leaderboard] Update complete.`); // Can be verbose
  };
  
  // --- Tower Simulator Constants ---
  // REMOVED Global Tower Position Constants - Replaced by towerBaseLocations array
  // const TOWER_CENTER_X = 28.5;
  // const TOWER_BASE_Y = 2.75; 
  // const TOWER_CENTER_Z = -1.5; 
  const TOWER_DEFAULT_BASE_Y = 2.75; // Keep default Y level
  const TOWER_WIDTH = 4; // Assuming all towers are 4x4 for now
  const TOWER_DEPTH = 4;
  const STONE_BLOCK_ID = 1; // Assuming ID 1 is Stone
  const WOOD_BLOCK_ID = 17; // Assuming ID 17 is Oak Wood Planks (verify if needed)
  const BLOCKS_PER_LAYER = TOWER_WIDTH * TOWER_DEPTH;

  // --- ADDED: Predefined Tower Base Locations --- 
  interface TowerLocation {
    center: Vector3Like;
    width: number;
    depth: number;
  }

  const towerBaseLocations: TowerLocation[] = [
    { center: { x: 28.5, y: TOWER_DEFAULT_BASE_Y, z: -1.5 }, width: 4, depth: 4 }, // Original location (Player 1)
    { center: { x: 0.5,  y: TOWER_DEFAULT_BASE_Y, z: -26 },  width: 4, depth: 4 }, // Adjusted location for player 2
    { center: { x: -28,  y: TOWER_DEFAULT_BASE_Y, z: -1.5 }, width: 4, depth: 4 }, // Adjusted location for player 3
    { center: { x: 1.0,  y: TOWER_DEFAULT_BASE_Y, z: 30.0 }, width: 4, depth: 4 }, // Added location for player 4
  ];
  let nextTowerIndex = 0; // Track the next available tower slot

  // --- Tower Simulator Player State ---
  // Tracks how many blocks a player can place
  const playerBlockResources = new Map<string, number>(); // Track blocks for tower building

  // --- ADDED: Map to track player build speed multipliers ---
  const playerMultipliers = new Map<string, number>();
  // --- END ADDED ---

  // MODIFIED: Tracks tower state including location and progress per player
  interface PlayerTowerState {
    location: TowerLocation;
    currentY: number;
    layerIndex: number;
    isHovering: boolean; // <<< ADDED: Track hover state
  }
  const playerTowerData: Map<string, PlayerTowerState> = new Map();

  // Tracks the SceneUI instance for each player's floor display
  const playerFloorDisplayUIs: Map<string, SceneUI> = new Map();
  // Tracks the block counter UI for each player
  const playerBlockCounterUIs: Map<string, SceneUI> = new Map();
  // Tracks the interval ID for block generation for each player
  const playerBlockIntervals: Map<string, NodeJS.Timeout> = new Map(); // Use NodeJS.Timeout type
  
  // Initialize global interaction counters
  let totalInteractions = 0;
  
  // Load global statistics from persistence
  PersistenceManager.instance.getGlobalData('petStats').then(stats => {
    // Ensure stats and totalInteractions exist and are the correct type
    if (stats && typeof stats.totalInteractions === 'number') { 
      totalInteractions = stats.totalInteractions;
      console.log(`Loaded total pet interactions: ${totalInteractions}`);
    } else if (stats) {
      console.warn("Loaded stats object does not contain a valid 'totalInteractions' number:", stats);
      totalInteractions = 0; // Default to 0 if invalid
    } else {
      totalInteractions = 0; // Default to 0 if no stats found
    }
  }).catch(error => {
    console.error("Error loading global stats:", error);
  });
  
  // Function to update global statistics
  const updateGlobalStats = () => {
    PersistenceManager.instance.setGlobalData('petStats', {
      totalInteractions,
      lastUpdated: new Date().toISOString()
    }).catch(error => {
      console.error("Error saving global stats:", error);
    });
    
    // Update stats for all connected players (Overlay UI)
    for (const playerEntity of playerEntities.values()) {
      playerEntity.player.ui.sendData({
        type: 'updateStats',
        totalInteractions
      });
    }

    // Update the state of the leaderboard Scene UI
    // if (leaderboardSceneUI) {
    //   leaderboardSceneUI.setState({ totalInteractions });
    // }
  };

  /**
   * Calculate distance between two Vector3-like positions
   */
  const calculateDistance = (pos1: Vector3 | {x:number, y:number, z:number}, pos2: Vector3 | {x:number, y:number, z:number}): number => {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  /**
   * Update pet movement towards target player
   */
  const updatePetMovement = (pet: Entity, playerEntity: PlayerEntity, walkAnimation: string, idleAnimation: string) => {
    const petPos = pet.position;
    const playerPos = playerEntity.position;

    // --- MODIFIED: Added specific logic for Doge Dog --- 
    if (pet.modelUri === DIAMOND_PET_MODEL_URI) {
      // --- Doge Dog Flying Logic ---
      const targetPos = { x: playerPos.x, y: playerPos.y + PET_HOVER_OFFSET_Y, z: playerPos.z };
      const dirX = targetPos.x - petPos.x;
      const dirY = targetPos.y - petPos.y;
      const dirZ = targetPos.z - petPos.z;
      const distance = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);

      // Only move if not very close to the target hover position
      if (distance > 0.2) { 
        const speed = Math.min(distance * 0.4, 1.5); // Adjusted speed factors for flying
        const normalizedDirX = dirX / distance;
        const normalizedDirY = dirY / distance;
        const normalizedDirZ = dirZ / distance;
        pet.setLinearVelocity({ 
          x: normalizedDirX * speed * 10,
          y: normalizedDirY * speed * 10, // Apply Y velocity for flying
          z: normalizedDirZ * speed * 10,
        });
      } else {
        // Hover gently when close enough
        pet.setLinearVelocity({ x: 0, y: 0.1, z: 0 }); // Slight upward drift to counteract gravity/jitter
      }
      // No rotation or animation changes needed for spinning Doge Dog
      // --- End Doge Dog Flying Logic ---

    // --- ADDED: Bat Flying Logic --- 
    } else if (pet.modelUri === BAT_MODEL_URI) {
      // --- MODIFIED: Calculate target position *behind* the player --- 
      const playerForward = playerEntity.directionFromRotation; // Get player's forward direction vector
      const backwardOffset = 0.8; // How far behind the player the bat should follow
      const targetX = playerPos.x - playerForward.x * backwardOffset;
      const targetY = playerPos.y + PET_HOVER_OFFSET_Y + 0.2; // Keep vertical offset
      const targetZ = playerPos.z - playerForward.z * backwardOffset;
      const targetPos = { x: targetX, y: targetY, z: targetZ }; 
      // const targetPos = { x: playerPos.x, y: playerPos.y + PET_HOVER_OFFSET_Y + 0.2, z: playerPos.z }; // OLD: Directly above
      // --- END MODIFIED --- 
      const dirX = targetPos.x - petPos.x;
      const dirY = targetPos.y - petPos.y;
      const dirZ = targetPos.z - petPos.z;
      const distance = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);

      if (distance > 0.5) { // Increased stop distance slightly for bat
        const speed = Math.min(distance * 0.5, 1.8); // Slightly different speed profile
        const normalizedDirX = dirX / distance;
        const normalizedDirY = dirY / distance;
        const normalizedDirZ = dirZ / distance;
        pet.setLinearVelocity({ 
          x: normalizedDirX * speed * 10,
          y: normalizedDirY * speed * 10, // Y velocity for flying
          z: normalizedDirZ * speed * 10,
        });

        // Face the player (only XZ rotation)
        const xzAngle = Math.atan2(dirX, dirZ) + Math.PI; 
        const halfAngle = xzAngle / 2;
        pet.setRotation({ x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) });

        // Start walk/fly animation
        if (walkAnimation && !pet.modelLoopedAnimations.has(walkAnimation)) {
            // if (idleAnimation) pet.stopModelAnimations([idleAnimation]); // Don't stop idle if it doesn't exist
            pet.startModelLoopedAnimations([walkAnimation]); // Use walk/fly animation
        }
      } else {
        // Hover when close
        pet.setLinearVelocity({ x: 0, y: 0.1, z: 0 }); 
        pet.setAngularVelocity({ x: 0, y: 0, z: 0 });

        // --- MODIFIED: Start walk/fly animation even when hovering --- 
        if (walkAnimation && !pet.modelLoopedAnimations.has(walkAnimation)) {
            // if (idleAnimation) pet.stopModelAnimations([idleAnimation]); // Don't stop idle if it doesn't exist
            pet.startModelLoopedAnimations([walkAnimation]); // Use walk/fly animation
        }
        // --- END MODIFIED ---
      }
    // --- End Bat Flying Logic ---

    // --- ADDED: Squid Flying Logic --- 
    } else if (pet.modelUri === SQUID_MODEL_URI) {
      const targetPos = { x: playerPos.x, y: playerPos.y + PET_HOVER_OFFSET_Y + 0.5, z: playerPos.z }; // Target point above player head (slightly higher?)
      const dirX = targetPos.x - petPos.x;
      const dirY = targetPos.y - petPos.y;
      const dirZ = targetPos.z - petPos.z;
      const distance = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);

      if (distance > 0.6) { // Stop distance for squid
        const speed = Math.min(distance * 0.6, 2.0); // Different speed profile for squid
        const normalizedDirX = dirX / distance;
        const normalizedDirY = dirY / distance;
        const normalizedDirZ = dirZ / distance;
        pet.setLinearVelocity({ 
          x: normalizedDirX * speed * 10,
          y: normalizedDirY * speed * 10, // Y velocity for flying
          z: normalizedDirZ * speed * 10,
        });

        // Face the player (only XZ rotation)
        const xzAngle = Math.atan2(dirX, dirZ) + Math.PI; 
        const halfAngle = xzAngle / 2;
        pet.setRotation({ x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) });

        // Start walk/fly animation
        if (walkAnimation && !pet.modelLoopedAnimations.has(walkAnimation)) {
            if (idleAnimation) pet.stopModelAnimations([idleAnimation]);
            pet.startModelLoopedAnimations([walkAnimation]);
        }
      } else {
        // Hover when close
        pet.setLinearVelocity({ x: 0, y: 0.1, z: 0 }); 
        pet.setAngularVelocity({ x: 0, y: 0, z: 0 });

        // Start idle animation
        if (idleAnimation && !pet.modelLoopedAnimations.has(idleAnimation)) {
            if (walkAnimation) pet.stopModelAnimations([walkAnimation]);
            pet.startModelLoopedAnimations([idleAnimation]);
        }
      }
    // --- End Squid Flying Logic ---

    // --- ADDED: Payload Bomb Ground Logic ---
    } else if (pet.modelUri === PAYLOAD_BOMB_MODEL_URI) {
      const dirX = playerPos.x - petPos.x;
      const dirZ = playerPos.z - petPos.z;
      const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);

      // Only follow and rotate if not too close
      if (distance > 2.0) {
        // Apply specific Payload Bomb rotation (270 degrees offset)
        const angle = Math.atan2(dirX, dirZ) + Math.PI + (Math.PI / 2); 
        const halfAngle = angle / 2;
        pet.setRotation({ x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) });

        // Calculate speed based on distance
        const speed = Math.min(distance * 0.1, 0.5);

        // Animation: Play walk animation
        if (walkAnimation && !pet.modelLoopedAnimations.has(walkAnimation)) {
            // No idle animation to stop for payload bomb
            pet.startModelLoopedAnimations([walkAnimation]);
        }

        // Apply velocity ONLY in XZ, let gravity handle Y
        const normalizedDirX = dirX / distance;
        const normalizedDirZ = dirZ / distance;
        pet.setLinearVelocity({ 
            x: normalizedDirX * speed * 10, 
            y: pet.linearVelocity.y, // <<< IMPORTANT: Keep current Y velocity to allow gravity
            z: normalizedDirZ * speed * 10 
        });
      } else {
        // Stop horizontal movement when close
        pet.setLinearVelocity({ x: 0, y: pet.linearVelocity.y, z: 0 }); // <<< Keep Y velocity
        pet.setAngularVelocity({ x: 0, y: 0, z: 0 }); // Stop rotation

        // Animation: Stop walk animation (since there's no idle)
        if (walkAnimation && pet.modelLoopedAnimations.has(walkAnimation)) {
            pet.stopModelAnimations([walkAnimation]);
        }
      }
    // --- End Payload Bomb Ground Logic ---

    } else {
      // --- Existing Generic Ground Pet Logic (for all others) ---
      const dirX = playerPos.x - petPos.x;
      const dirZ = playerPos.z - petPos.z;
      const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);
      
      // Only follow and rotate if not too close to avoid jittering
      if (distance > 2.0) {
          // Rotate NON-Doge pets
          if (pet.modelUri !== DIAMOND_PET_MODEL_URI) { // Exclude Doge from default rotation
            // Calculate the angle from pet to player ONLY in the XZ plane + 180 degrees
            const angle = Math.atan2(dirX, dirZ) + Math.PI;
            const halfAngle = angle / 2;
            pet.setRotation({ x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) }); // Apply rotation
          }
          
          // Calculate speed based on distance (move faster when further away)
          const speed = Math.min(distance * 0.1, 0.5);

          // --- Animation Control --- 
          if (walkAnimation) { // Check if walk animation exists
              if (!pet.modelLoopedAnimations.has(walkAnimation)) {
                  if (idleAnimation) pet.stopModelAnimations([idleAnimation]);
                  pet.startModelLoopedAnimations([walkAnimation]);
              }
          } 
          // --- End Animation Control ---

          // Apply velocity primarily in XZ, let gravity handle Y
          const normalizedDirX = dirX / distance;
          const normalizedDirZ = dirZ / distance;
          pet.setLinearVelocity({ 
            x: normalizedDirX * speed * 10, 
            y: pet.linearVelocity.y, // <<< Allow gravity
            z: normalizedDirZ * speed * 10 
          });

      } else {
          // Stop horizontal moving when close enough
          pet.setLinearVelocity({ x: 0, y: pet.linearVelocity.y, z: 0 }); // <<< Allow gravity
          pet.setAngularVelocity({ x: 0, y: 0, z: 0 }); // Ensure non-Doge pets stop spinning when close

          // Play idle animation when not moving (close to player)
          if (idleAnimation) { // Check if idle animation exists
              if (!pet.modelLoopedAnimations.has(idleAnimation)) {
                  if (walkAnimation) pet.stopModelAnimations([walkAnimation]);
                  pet.startModelLoopedAnimations([idleAnimation]);
              }
          }
      }
      // --- End Generic Ground Pet Logic ---
    }
  };

  // --- Tower Simulator: Function to place the next block --- 
  const tryBuildTowerBlock = (playerId: string) => {
    const resources = playerBlockResources.get(playerId);
    const towerData = playerTowerData.get(playerId);

    // Check if player has tower data
    if (!towerData) {
      return; // Cannot build
    }

    // --- MODIFIED: Calculate points and loop block placement --- 
    const currentScore = playerScores.get(playerId) ?? 0;
    const multiplier = playerMultipliers.get(playerId) ?? MULTIPLIER_DEFAULT;
    const pointsPerTick = Math.max(1, Math.round(1 * multiplier)); // Calculate points (minimum 1)
    let pointsAwardedThisTick = 0;

    // console.log(`[TowerBuild][TICK] Player: ${playerId}, Multiplier: ${multiplier.toFixed(1)}x, Blocks to place: ${pointsPerTick}`); // <<< COMMENTED OUT

    for (let i = 0; i < pointsPerTick; i++) {
      // Calculate block position based on the *current* tower state
      const towerWidth = towerData.location.width;
      const towerDepth = towerData.location.depth;
      const blocksPerLayer = towerWidth * towerDepth;

      // If layerIndex is 0, it means we need to start a new layer
      if (towerData.layerIndex === 0 && towerData.currentY > towerData.location.center.y) {
        // This check prevents incrementing Y if we are at the very start (Y=center, index=0)
        // Safety check: ensure we don't place blocks below base
        // Although the loop termination should prevent this, it adds safety.
        // Removed the check as the main loop condition handles it.
      }
      // If we completed a layer in the *previous* iteration of this loop
      if (towerData.layerIndex >= blocksPerLayer) {
        towerData.layerIndex = 0;
        towerData.currentY++;
        const floorDisplayUI = playerFloorDisplayUIs.get(playerId);
        if (floorDisplayUI) {
          const currentFloor = towerData.currentY - towerData.location.center.y + 1;
          floorDisplayUI.setState({ floor: currentFloor });
        }
        // console.log(`[TowerBuild][LAYER UP] Player: ${playerId}, New Y: ${towerData.currentY}`); // <<< COMMENTED OUT
      }

      // Calculate position for the *current* block within the loop
      const layerX = towerData.layerIndex % towerWidth;
      const layerZ = Math.floor(towerData.layerIndex / towerWidth);
      const blockX = towerData.location.center.x - (towerWidth / 2 - 0.5) + layerX;
      const blockY = towerData.currentY; // Use the potentially updated Y
      const blockZ = towerData.location.center.z - (towerDepth / 2 - 0.5) + layerZ;
      const isCorner = (layerX === 0 || layerX === towerWidth - 1) && (layerZ === 0 || layerZ === towerDepth - 1);
      const blockTypeId = isCorner ? STONE_BLOCK_ID : WOOD_BLOCK_ID;
      const flooredX = Math.floor(blockX);
      const flooredZ = Math.floor(blockZ);
      const targetBlockPos = new Vector3(flooredX, blockY, flooredZ);

      // Place the actual block
      world.chunkLattice.setBlock(targetBlockPos, blockTypeId);
      pointsAwardedThisTick++; // Count this block/point

      // Update tower state for the *next* iteration or tick
      towerData.layerIndex++; 
      
      // Spawn visual effect (optional, can be kept or removed)
      const playerEntity = playerEntities.get(playerId);
      if (playerEntity) {
          const startPos = new Vector3(playerEntity.position.x, playerEntity.position.y + 0.5, playerEntity.position.z);
          const endPos = new Vector3(targetBlockPos.x + 0.5, targetBlockPos.y + 0.5, targetBlockPos.z + 0.5);
          // Orb logic unchanged...
          const travelDuration = 0.3;
          const direction = new Vector3(endPos.x - startPos.x, endPos.y - startPos.y, endPos.z - startPos.z);
          const distance = direction.length;
          direction.normalize(); 
          const speed = distance / travelDuration;
          const velocity = new Vector3(direction.x * speed, direction.y * speed, direction.z * speed);
          const orbVisual = new Entity({
            modelUri: 'models/projectiles/energy-orb-projectile.gltf',
            modelScale: 0.3, 
            rigidBodyOptions: {
              type: RigidBodyType.KINEMATIC_VELOCITY, 
              linearVelocity: velocity, 
              colliders: [{ shape: ColliderShape.BALL, radius: 0.2, isSensor: true }]
            }
          });
          orbVisual.spawn(world, startPos);
          setTimeout(() => { orbVisual.despawn(); }, travelDuration * 1000);        
      }
    }

    // Update score AFTER the loop with the total points/blocks placed this tick
    playerScores.set(playerId, currentScore + pointsAwardedThisTick);
    // console.log(`[Points] Player ${playerId} got ${pointsAwardedThisTick} points this tick (Multiplier: ${multiplier.toFixed(1)}x)`); // <<< COMMENTED OUT
    updateLeaderboard(); // Update the leaderboard display
    
    // Save the final tower state after placing all blocks for this tick
    playerTowerData.set(playerId, towerData); 
    // --- END MODIFIED ---

    // --- ADDED: Update player position if hovering ---
    updateHoveringPlayerPosition(playerId);
    // --- END ADDED ---
  };

  // --- ADDED: Function to start/update tower building interval ---
  const startOrUpdateTowerBuilding = (playerId: string) => {
    // Clear existing interval if it exists
    const existingInterval = playerBlockIntervals.get(`tower_${playerId}`);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Get player's multiplier (default to 1)
    const multiplier = playerMultipliers.get(playerId) ?? 1.0;

    // --- MODIFIED: Use BASE interval, multiplier affects amount per tick ---
    // Calculate effective interval duration (base interval / multiplier)
    const BASE_TOWER_BUILD_INTERVAL_MS = 400; // <<< CHANGED: Slower base speed (was 200)
    // const effectiveInterval = Math.max(50, BASE_TOWER_BUILD_INTERVAL_MS / multiplier); // Ensure interval doesn't go too low (e.g., max 20 blocks/sec)
    const effectiveInterval = BASE_TOWER_BUILD_INTERVAL_MS; // Always use base interval
    // --- END MODIFIED ---

    // console.log(`[TowerBuild][INFO] Starting tower build for ${playerId} with multiplier ${multiplier.toFixed(1)}x, interval ${effectiveInterval.toFixed(0)}ms (Amount per tick modified)`); // <<< COMMENTED OUT // Log updated

    // Start new interval
    const newIntervalId = setInterval(() => {
      tryBuildTowerBlock(playerId);
    }, effectiveInterval);

    // Store the new interval ID
    playerBlockIntervals.set(`tower_${playerId}`, newIntervalId);
  };
  // --- END ADDED ---

  // --- Animal Constants ---
  const RABBIT_MODEL_URI = 'models/npcs/rabbit.gltf';
  const RABBIT_MODEL_SCALE = 0.6;
  const PIG_MODEL_URI = 'models/npcs/pig.gltf'; // Added Pig
  const PIG_MODEL_SCALE = 0.4; // Added Pig Scale (adjust as needed) - Reduced size
  const CHICKEN_MODEL_URI = 'models/npcs/chicken.gltf'; // Added Chicken
  const CHICKEN_MODEL_SCALE = 0.3; // Added Chicken Scale (adjust as needed) - Made smaller than pig

  // Type definition for possible animal types
  type AnimalType = 'rabbit' | 'pig' | 'chicken';

  // --- State Management for Multiple Eggs ---
  interface EggState {
    entity: Entity;
    basePosition: Vector3;
    modelUri: string;
    isOpening: boolean;
    openStartTime: number | null;
    openingPlayerId: string | null;
    animationTime: number;
    eggType: EggType;
  }

  const activeEggs: Map<number, EggState> = new Map(); // Use entity ID (number) as key

  // --- Egg Constants ---
  const EGG_INTERACT_DISTANCE = 2.0; // How close player must be to interact
  const EGG_OPEN_DURATION_MS = 3000; // Duration of the opening animation (ms)
  const EGG_SHAKE_AMPLITUDE = 0.05; // How much the egg shakes
  const EGG_FLOAT_AMPLITUDE = 0.05; // How high/low it floats (more subtle)
  const EGG_FLOAT_SPEED = 0.5; // How fast it floats (radians per second) - Slower for smoothness
  const EGG_ROTATE_SPEED = 0.5; // How fast it rotates (radians per second)
  const EGG_RESPAWN_DELAY_MS = 6000; // 6 seconds

  /**
   * Handle the tick event for an individual egg entity.
   * This function ONLY manages the opening animation, despawning, 
   * and floating/spinning visual state.
   * Proximity checks are now handled centrally in the player tick loop.
   */
  const handleEggTick = async (payload: { entity: Entity; tickDeltaMs: number; }) => { // <<< Make async
    const { entity, tickDeltaMs } = payload;
    
    // Ensure the log message is commented out
    // console.log(`handleEggTick called for entity ID: ${entity.id}`); 

    // Check if entity ID is valid before using map
    if (typeof entity.id !== 'number') {
        console.warn("handleEggTick called with invalid entity ID.");
        return;
    }

    // Retrieve the state for this specific egg using the numeric ID
    const eggState = activeEggs.get(entity.id);
    if (!eggState) {
      // console.warn(`handleEggTick called for entity ${entity.id} with no state found.`);
      // Attempt to remove the listener using the same function reference
      entity.off(EntityEvent.TICK, handleEggTick); 
      return;
    }

    // --- General Egg Logic (Floating, Opening) applies to ALL eggs --- 
    const deltaTimeS = tickDeltaMs / 1000.0;
    eggState.animationTime += deltaTimeS;

    // Initialize default values
    let currentRotateSpeed = EGG_ROTATE_SPEED;
    let currentShakeAmplitude = 0; // No shake by default

    // --- Handle Opening Sequence ---
    if (eggState.isOpening && eggState.openStartTime) {
      const elapsedTime = Date.now() - eggState.openStartTime;
      const openingProgress = Math.min(elapsedTime / EGG_OPEN_DURATION_MS, 1); // 0 to 1

      // --- Apply Opening Animation Effects ---
      currentRotateSpeed = EGG_ROTATE_SPEED * (1 + openingProgress * 2); // Spin faster as it opens
      currentShakeAmplitude = EGG_SHAKE_AMPLITUDE * Math.sin(elapsedTime * 0.05);
      // --- End Opening Animation Effects ---

      // --- Check if hatching time is reached ---
      if (elapsedTime >= EGG_OPEN_DURATION_MS) {
        console.log(`Egg (${entity.id}, Type: ${eggState.eggType}) hatching!`); // Log type
        const hatchPosition = entity.position; // Get position before despawning
        const openingPlayerId = eggState.openingPlayerId;
        const openingPlayerEntity = playerEntities.get(openingPlayerId || ''); // Get player who opened
        const originalEggId = entity.id; // <<< CAPTURE ID BEFORE DESPAWN
        
        // Remove the problematic reference to player
        // const player = ...

        // Despawn egg and remove its state
        entity.despawn();
        if (typeof originalEggId === 'number') { // <<< USE CAPTURED ID
          activeEggs.delete(originalEggId);
        } else {
          console.warn("Could not delete egg state: Captured originalEggId was not a number."); // Updated warning
        }

        // --- Determine which animal hatches based on eggType ---
        let petModelUri: string;
        let petScale: number;
        let petIdleAnimation: string;
        let petWalkAnimation: string;
        let petTypeName: string;

        switch (eggState.eggType) {
          case EggType.SILVER:
            // --- MODIFIED: Percentage-Based Silver Pet Hatching ---
            const silverRoll = Math.random() * 100;

            if (silverRoll < 50) { // 0 - 49.99... (50% chance - Cow)
                petModelUri = COW_MODEL_URI;
                petScale = COW_MODEL_SCALE;
                petIdleAnimation = COW_IDLE_ANIMATION;
                petWalkAnimation = COW_WALK_ANIMATION;
                petTypeName = 'Cow';
                console.log(`Silver Egg hatched a Cow! (Roll: ${silverRoll.toFixed(2)} < 50)`);
            } else if (silverRoll < 86) { // 50 - 85.99... (36% chance - Bat)
                petModelUri = BAT_MODEL_URI;
                petScale = BAT_MODEL_SCALE;
                petIdleAnimation = BAT_IDLE_ANIMATION;
                petWalkAnimation = BAT_WALK_ANIMATION;
                petTypeName = 'Bat';
                console.log(`Silver Egg hatched a Bat! (Roll: ${silverRoll.toFixed(2)} < 86)`);
            } else { // 86 - 99.99... (14% chance - Sheep)
                petModelUri = SHEEP_MODEL_URI;
                petScale = SHEEP_MODEL_SCALE;
                petIdleAnimation = SHEEP_IDLE_ANIMATION;
                petWalkAnimation = SHEEP_WALK_ANIMATION;
                petTypeName = 'Sheep';
                console.log(`Silver Egg hatched a Sheep! (Roll: ${silverRoll.toFixed(2)} >= 86)`);
            }
            // --- END MODIFIED ---
            break;
          case EggType.GOLDEN:
            // --- MODIFIED: Percentage-Based Golden Pet Hatching ---
            const goldenRoll = Math.random() * 100;
            
            if (goldenRoll < 61.5) { // 0 - 61.49... (61.5% chance - Donkey)
                petModelUri = DONKEY_MODEL_URI;
                petScale = DONKEY_MODEL_SCALE;
                petIdleAnimation = DONKEY_IDLE_ANIMATION;
                petWalkAnimation = DONKEY_WALK_ANIMATION;
                petTypeName = 'Donkey';
                console.log(`Golden Egg hatched a Donkey! (Roll: ${goldenRoll.toFixed(2)} < 61.5)`);
            } else if (goldenRoll < 89.8) { // 61.5 - 89.79... (28.3% chance - Squid)
                petModelUri = SQUID_MODEL_URI;
                petScale = SQUID_MODEL_SCALE;
                petIdleAnimation = SQUID_IDLE_ANIMATION;
                petWalkAnimation = SQUID_WALK_ANIMATION; // Will be treated as flying
                petTypeName = 'Squid';
                console.log(`Golden Egg hatched a Squid! (Roll: ${goldenRoll.toFixed(2)} < 89.8)`);
            } else { // 89.8 - 99.99... (10.2% chance - Ocelot)
                petModelUri = OCELOT_MODEL_URI;
                petScale = OCELOT_MODEL_SCALE;
                petIdleAnimation = OCELOT_IDLE_ANIMATION;
                petWalkAnimation = OCELOT_WALK_ANIMATION;
                petTypeName = 'Ocelot';
                console.log(`Golden Egg hatched an Ocelot! (Roll: ${goldenRoll.toFixed(2)} >= 89.8)`);
            }
            // --- END MODIFIED ---
            break;
          case EggType.DIAMOND:
            // --- MODIFIED: Percentage-Based Diamond Pet Hatching ---
            const diamondRoll = Math.random() * 100;
            
            if (diamondRoll < 75) { // 0 - 74.99... (75% chance - Spider)
                petModelUri = SPIDER_MODEL_URI;
                petScale = SPIDER_MODEL_SCALE;
                petIdleAnimation = SPIDER_IDLE_ANIMATION;
                petWalkAnimation = SPIDER_WALK_ANIMATION;
                petTypeName = 'Spider';
                console.log(`Diamond Egg hatched a Spider! (Roll: ${diamondRoll.toFixed(2)} < 75)`);
            } else if (diamondRoll < 95) { // 75 - 94.99... (20% chance - Payload Bomb)
                // --- Use Payload Bomb Constants ---
                petModelUri = PAYLOAD_BOMB_MODEL_URI;
                petScale = PAYLOAD_BOMB_SCALE;
                petIdleAnimation = ''; // No idle animation for payload bomb
                petWalkAnimation = PAYLOAD_BOMB_WALK_ANIMATION;
                // --- End Payload Bomb Constants ---
                petTypeName = 'Payload Bomb';
                console.log(`Diamond Egg hatched a Payload Bomb! (Roll: ${diamondRoll.toFixed(2)} < 95)`);
            } else { // 95 - 99.99... (5% chance - Doge Dog / DD)
                // --- Use DD (DIAMOND_PET_) Constants ---
                petModelUri = DIAMOND_PET_MODEL_URI;
                petScale = DIAMOND_PET_SCALE;
                petIdleAnimation = DIAMOND_PET_IDLE_ANIMATION;
                petWalkAnimation = DIAMOND_PET_WALK_ANIMATION;
                // --- End Correction ---
                petTypeName = 'DD'; // Renamed to DD
                console.log(`Diamond Egg hatched a DD! (Roll: ${diamondRoll.toFixed(2)} >= 95)`);
            }
            // --- END MODIFIED ---
            break;
          case EggType.BASIC:
          default:
            // --- MODIFIED: Percentage-Based Basic Pet Hatching ---
            const roll = Math.random() * 100; // Generate random number 0-99.99...
            
            if (roll < 50) { // 0 - 49.99... (50% chance)
                petModelUri = CHICKEN_MODEL_URI;
                petScale = CHICKEN_MODEL_SCALE;
                petIdleAnimation = CHICKEN_IDLE_ANIMATION;
                petWalkAnimation = CHICKEN_WALK_ANIMATION;
                petTypeName = 'Chicken';
                console.log(`Basic Egg hatched a Chicken! (Roll: ${roll.toFixed(2)} < 50)`);
            } else if (roll < 80) { // 50 - 79.99... (30% chance)
                petModelUri = BASIC_PET_MODEL_URI; // Rabbit is basic
                petScale = BASIC_PET_SCALE;
                petIdleAnimation = BASIC_PET_IDLE_ANIMATION;
                petWalkAnimation = BASIC_PET_WALK_ANIMATION;
                petTypeName = 'Rabbit';
                console.log(`Basic Egg hatched a Rabbit! (Roll: ${roll.toFixed(2)} < 80)`);
            } else { // 80 - 99.99... (20% chance)
                petModelUri = PIG_MODEL_URI;
                petScale = PIG_MODEL_SCALE;
                petIdleAnimation = PIG_IDLE_ANIMATION;
                petWalkAnimation = PIG_WALK_ANIMATION;
                petTypeName = 'Pig';
                console.log(`Basic Egg hatched a Pig! (Roll: ${roll.toFixed(2)} >= 80)`);
            }
            // --- END MODIFIED ---
            break;
        }

        // --- Calculate Spawn Position --- 
        // const spawnPosition = hatchPosition; // OLD: Spawned at exact hatch location
        // --- ADDED: Add a small random horizontal offset to prevent stacking on spawn ---
        const spawnOffsetRadius = 0.3; // Max distance from original hatch point (adjust as needed)
        const randomAngle = Math.random() * Math.PI * 2; // Random direction
        const offsetX = Math.cos(randomAngle) * spawnOffsetRadius;
        const offsetZ = Math.sin(randomAngle) * spawnOffsetRadius;
        const spawnPosition = {
            x: hatchPosition.x + offsetX,
            y: hatchPosition.y, // Keep original Y level
            z: hatchPosition.z + offsetZ,
        };
        // --- END ADDED ---
        const verticalNudge = 0; 

        // --- Spawn the chosen animal ---
        const newPet = new Entity({
          modelUri: petModelUri,
          modelScale: petScale,
          rigidBodyOptions: {
            type: RigidBodyType.DYNAMIC,
            // --- REMOVED incorrect collisionGroups setting here ---
          },
          modelLoopedAnimations: petIdleAnimation ? [petIdleAnimation] : [], // Start idle if exists
          // No controller needed here, added in makePetFollow
        });

        // Initialize follow state for the new pet
        const petFollowState: PetFollowState = {
          isFollowing: false,
          targetPlayerId: null,
          targetEntity: null,
        };
        petFollowStates.set(newPet, petFollowState);

        // Spawn pet at the *offset* position
        newPet.spawn(world, spawnPosition); // Use the calculated offset position
        // console.log(`${petTypeName} spawned at:`, spawnPosition); // OLD LOG
        console.log(`${petTypeName} spawned at offset position: (${spawnPosition.x.toFixed(2)}, ${spawnPosition.y.toFixed(2)}, ${spawnPosition.z.toFixed(2)})`); // UPDATE LOG

        // --- ADDED: Persistence Logic for Owned Pets List ---
        let successFullyPersisted = false; // Flag to track if persistence succeeded
        if (openingPlayerEntity && newPet.id !== undefined) { // Ensure player and new pet ID exist
            try {
                console.log(`[DEBUG] Starting pet persistence for player ${openingPlayerEntity.player.username}`);
                
                // 1. Generate a unique persistent ID for this pet instance
                const persistentPetId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                console.log(`[DEBUG] Generated persistent ID: ${persistentPetId}`);

                // 2. Fetch the current list of owned pets (or initialize if none)
                const currentData = await openingPlayerEntity.player.getPersistedData();
                console.log(`[DEBUG] Current persisted data:`, currentData);
                
                // Ensure currentData.ownedPets is an array, initialize if not
                const ownedPets: Array<{ persistentId: string; type: string; modelUri: string }> = 
                    Array.isArray(currentData?.ownedPets) ? currentData.ownedPets : [];
                console.log(`[DEBUG] Current owned pets count: ${ownedPets.length}`);

                // 3. Add the new pet to the list
                ownedPets.push({
                    persistentId: persistentPetId,
                    type: petTypeName,
                    modelUri: petModelUri
                });
                console.log(`[DEBUG] Added new pet to list. New count: ${ownedPets.length}`);

                // 4. Save the updated list back to persistence
                await openingPlayerEntity.player.setPersistedData({ ownedPets: ownedPets });
                console.log(`[DEBUG] Successfully saved updated pet list to persistence`);
                
                // 5. Store the mapping from runtime entity ID to persistent ID
                entityIdToPersistentIdMap.set(newPet.id, persistentPetId);
                console.log(`[DEBUG] Mapped entity ID ${newPet.id} to persistent ID ${persistentPetId}`);
                
                successFullyPersisted = true;
                console.log(`[DEBUG] Pet persistence completed successfully`);

                // 6. Send an immediate update to the UI
                openingPlayerEntity.player.ui.sendData({
                    type: 'updateOwnedPets',
                    pets: ownedPets
                });
                console.log(`[DEBUG] Sent immediate UI update with ${ownedPets.length} pets`);

            } catch (error) {
                console.error(`[ERROR] Failed to update persisted pet data for player ${openingPlayerEntity.player.username}:`, error);
            }
        } else {
            console.warn(`[WARN] Could not persist pet: ${!openingPlayerEntity ? 'Missing openingPlayerEntity' : 'Missing pet ID'} for egg ${originalEggId}`);
        }
        // --- END ADDED Persistence Logic ---

        // --- ADDED: Check Pet Limit (moved slightly earlier, but conceptually similar) ---
        let currentPetCount = 0;
        if (openingPlayerEntity) { 
          const openingPlayerId = openingPlayerEntity.player.id;
          for (const state of petFollowStates.values()) {
            if (state.isFollowing && state.targetPlayerId === openingPlayerId) {
              currentPetCount++;
            }
          }
          console.log(`Player ${openingPlayerEntity.player.username} has ${currentPetCount} pets following.`); 
        }
        const MAX_PETS_PER_PLAYER = 10;
        // --- END ADDED: Check Pet Limit ---

        // --- ADDED: Set Pet Collision Groups AFTER Spawning ---
        newPet.setCollisionGroupsForSolidColliders({
          belongsTo: [ COLLISION_GROUP_PETS ],
          collidesWith: [
            CollisionGroup.BLOCK, // Collide with terrain
            CollisionGroup.ENTITY, // Collide with other default entities
            COLLISION_GROUP_PETS, // <<< ADDED: Collide with other pets
            // NOTE: Excludes COLLISION_GROUP_PLAYERS
            CollisionGroup.ENTITY_SENSOR // Allow interacting with sensors
          ],
        });
        // --- END ADDED ---

        // --- ADDED: Delay before setting initial rotation ---
        setTimeout(() => {
          if (openingPlayerEntity && newPet.isSpawned) { // Check if pet still exists
            const playerPos = openingPlayerEntity.position;
            const petPos = newPet.position; // Use current position
            const dirX = playerPos.x - petPos.x;
            const dirZ = playerPos.z - petPos.z;
            const angle = Math.atan2(dirX, dirZ) + Math.PI;
            const halfAngle = angle / 2;
            const qy = Math.sin(halfAngle);
            const qw = Math.cos(halfAngle);
            newPet.setRotation({ x: 0, y: qy, z: 0, w: qw }); // Apply Y-axis rotation
            console.log(`Set initial rotation for ${petTypeName} (${newPet.id}) to face player ${openingPlayerEntity.player.username} (delayed)`);
          }
        }, 1); // Delay by 1 tick (adjust if needed)
        // --- END ADDED ---

        // Apply nudge impulse
        const nudgeImpulse = { x: (Math.random() - 0.5) * 4 * newPet.mass, y: verticalNudge, z: (Math.random() - 0.5) * 4 * newPet.mass };
        newPet.applyImpulse(nudgeImpulse);
        console.log(`Applied nudge impulse to ${petTypeName}:`, nudgeImpulse);

        // Create and Load Animal Nametag Scene UI
        const animalNametagUI = new SceneUI({
          templateId: 'rabbit-nametag',
          attachedToEntity: newPet,
          offset: { x: 0, y: petScale * 1.5, z: 0 },
          state: {
            ownerName: openingPlayerEntity?.player.username || 'Unknown',
            // --- UPDATED: Set status and class based on egg type ---
            status: eggState.eggType === EggType.BASIC ? 'Basic' : 
                    eggState.eggType === EggType.SILVER ? 'Rare' : 
                    eggState.eggType === EggType.GOLDEN ? 'Cool' : 
                    eggState.eggType === EggType.DIAMOND ? 'Mythic' : // <<< Diamond -> Mythic (Generic)
                    'Normal', 
            statusClass: eggState.eggType === EggType.BASIC ? 'status-basic' : 
                         eggState.eggType === EggType.SILVER ? 'status-rare' : 
                         eggState.eggType === EggType.GOLDEN ? 'status-cool' : 
                         eggState.eggType === EggType.DIAMOND ? 'status-mythic' : // <<< Diamond -> status-mythic (Generic)
                         'status-normal' 
            // --- END UPDATED ---
          },
        });
        animalNametagUI.load(world);

        // --- MODIFIED: Make pet follow ONLY if limit not reached AND PERSISTENCE SUCCEEDED ---
        if (openingPlayerEntity && successFullyPersisted) { // <<< Check persistence flag
          if (currentPetCount < MAX_PETS_PER_PLAYER) { 
            console.log(`Making ${petTypeName} (${newPet.id}) follow ${openingPlayerEntity.player.username}`);
            makePetFollow(newPet, openingPlayerEntity, petTypeName, petWalkAnimation, petIdleAnimation || ''); 

            // --- REMOVED old persistence logic here ---
            // const dataToSave = { playerPet: { ... } };
            // openingPlayerEntity.player.setPersistedData(dataToSave) // <<< REMOVED
          } else {
            // Send message to player if limit reached
            world.chatManager.sendPlayerMessage(
              openingPlayerEntity.player,
              `You already have the maximum of ${MAX_PETS_PER_PLAYER} pets following you! This new one will wander.`, 
              'FFFF00' // Yellow warning color
            );
            console.log(`Pet limit reached for ${openingPlayerEntity.player.username}. New pet ${newPet.id} will not follow.`);
          }
        } else if (openingPlayerEntity && !successFullyPersisted) {
            console.warn(`[WARN] Pet ${petTypeName} (${newPet.id}) hatched but persistence failed. It will not follow player ${openingPlayerEntity.player.username}.`);
            // Optional: Send a message to the player about the failure?
            // world.chatManager.sendPlayerMessage(openingPlayerEntity.player, `Error saving your new ${petTypeName}! It won't follow.`, 'FF0000');
        } else {
          console.warn(`Could not make pet follow: openingPlayerEntity not found for ID ${eggState.openingPlayerId}`);
        }
        // --- END MODIFIED --- 

        // --- ADDED BACK: Attach TICK listener FOR THIS SPECIFIC PET ---
        newPet.on(EntityEvent.TICK, () => {
          const followState = petFollowStates.get(newPet);
          if (followState?.isFollowing && followState.targetEntity && followState.targetPlayerId && playerEntities.has(followState.targetPlayerId)) {
            // Pass the specific animation names for the hatched pet
            updatePetMovement(newPet, followState.targetEntity, petWalkAnimation, petIdleAnimation || '');
          } else if (followState?.isFollowing) {
            // Stop following invalid target logic...
            console.log(`${petTypeName} (${newPet.id}) stopped following invalid target: ${followState.targetPlayerId}`);
            followState.isFollowing = false;
            followState.targetPlayerId = null;
            followState.targetEntity = null;
            if (petWalkAnimation) { 
                newPet.stopModelAnimations([petWalkAnimation]);
            }
            if (petIdleAnimation) { 
                newPet.startModelLoopedAnimations([petIdleAnimation]);
            }
            newPet.setLinearVelocity({ x: 0, y: 0, z: 0 });
            newPet.setAngularVelocity({ x: 0, y: 0, z: 0 });
          } else {
            // Idle logic (not following)
            newPet.setLinearVelocity({ x: 0, y: 0, z: 0 });
             if (newPet.modelUri !== DIAMOND_PET_MODEL_URI) { // Keep Doge spinning
                newPet.setAngularVelocity({ x: 0, y: 0, z: 0 });
                 if (petIdleAnimation && !newPet.modelLoopedAnimations.has(petIdleAnimation)) {
                     if(petWalkAnimation) newPet.stopModelAnimations([petWalkAnimation]); 
                     newPet.startModelLoopedAnimations([petIdleAnimation]);
                 }
             }
          }
        });
        // --- END ADDED BACK ---

        // --- ADDED: Schedule Respawn --- 
        const originalModelUri = eggState.modelUri;
        const originalPosition = eggState.basePosition; // Use the stored base position
        const originalEggType = eggState.eggType;
        console.log(`[DEBUG] Scheduling respawn for ${originalEggType} egg (Original ID: ${originalEggId}) in ${EGG_RESPAWN_DELAY_MS}ms.`); // Log BEFORE scheduling (use captured ID)
        setTimeout(() => {
          console.log(`[DEBUG] Respawn timer fired for ${originalEggType} egg (Original ID: ${originalEggId}).`); // Log INSIDE timer callback (use captured ID)
          // Removed the redundant log from createAndSpawnEgg itself
          createAndSpawnEgg(originalModelUri, originalPosition, originalEggType);
        }, EGG_RESPAWN_DELAY_MS);
        // --- END ADDED: Schedule Respawn --- 

        // --- Add pet to session storage for the opening player ---
        if (openingPlayerId) {
          const persistentId = generateId();
          console.log(`[DEBUG] Starting pet session storage for player with ID ${openingPlayerId}`);
          
          // Get or create player's session pets array
          if (!playerSessionPets.has(openingPlayerId)) {
            playerSessionPets.set(openingPlayerId, []);
          }
          
          // Add the pet to session storage
          const playerPets = playerSessionPets.get(openingPlayerId);
          if (playerPets && newPet.id !== undefined) {
            playerPets.push({ 
              type: petTypeName, 
              persistentId,
              rarity: eggState.eggType // <<< ADDED: Store rarity from the egg state
            });
            console.log(`[DEBUG] Added new pet (${petTypeName}, rarity: ${eggState.eggType}) to session list. New count: ${playerPets.length}`); // Updated log
            
            // Map entity ID to persistent ID for later reference
            entityIdToPersistentIdMap.set(newPet.id, persistentId);
            
            // --- ADDED: Check if this pet grants multiplier and update --- 
            // <<< ADDED Null Check for openingPlayerId >>>
            if (openingPlayerId) { 
              const isRabbitPet = petTypeName.toLowerCase() === 'rabbit';
              const isBasicEgg = eggState.eggType === EggType.BASIC;
              const currentMultiplier = playerMultipliers.get(openingPlayerId) ?? 1.0;
              
              if (isRabbitPet && isBasicEgg && currentMultiplier < 1.5) {
                console.log(`[Multiplier] Player ${openingPlayerId} hatched Basic Rabbit. Applying 1.5x multiplier.`);
                playerMultipliers.set(openingPlayerId, 1.5);
                startOrUpdateTowerBuilding(openingPlayerId); // Restart tower building with new speed
              }
            }
            // --- END ADDED --- 
            
            // Send immediate UI update to the player who opened the egg
            if (openingPlayerEntity?.player) {
              openingPlayerEntity.player.ui.sendData({
                type: 'updateOwnedPets',
                pets: playerPets
              });
              console.log(`[DEBUG] Sent immediate UI update with ${playerPets.length} pets`);
            }

            // --- MODIFIED: Always recalculate multiplier after adding pet ---
            console.log(`[Multiplier] Triggering multiplier recalculation for ${openingPlayerId} after hatching ${petTypeName}`);
            calculateAndUpdateMultiplier(openingPlayerId);
            // --- END MODIFIED ---
          }
        }

        return; // Exit tick handler for this egg after hatching
      }
      // --- End Hatching Check ---
    }
    // --- End Opening Sequence Handling ---

    // --- Floating Animation REVERTED to previous working logic ---
    if (!eggState.isOpening) {
      // Apply Normal Floating/Spinning when NOT opening
      entity.setAngularVelocity({ x: 0, y: currentRotateSpeed, z: 0 });
      const currentPositionVec = new Vector3(
        eggState.basePosition.x,
        eggState.basePosition.y + Math.sin(eggState.animationTime * EGG_FLOAT_SPEED) * EGG_FLOAT_AMPLITUDE,
        eggState.basePosition.z
      );
      entity.setPosition(currentPositionVec);
    } else {
        // Apply Opening Animation Effects (including shake)
        entity.setAngularVelocity({ x: 0, y: currentRotateSpeed, z: 0 }); // Spin faster
        const currentPositionVec = new Vector3(
            eggState.basePosition.x + currentShakeAmplitude, // Apply shake horizontally
            eggState.basePosition.y
                + Math.sin(eggState.animationTime * EGG_FLOAT_SPEED) * EGG_FLOAT_AMPLITUDE // Base float
                + currentShakeAmplitude, // Apply shake vertically (or adjust axis if needed)
            eggState.basePosition.z // Keep Z the same (or apply shake if desired)
        );
        entity.setPosition(currentPositionVec);
    }
    // --- End Reverted Floating Animation ---

    // --- REMOVED problematic isValid check ---

  }; // End of handleEggTick

  // --- Define makePetFollow *after* handleEggTick ---
  /**
   * Make a pet follow a player or stop following
   */
  const makePetFollow = (pet: Entity, playerEntity: PlayerEntity, petTypeName: string, petWalkAnimation: string, petIdleAnimation: string) => {
    const followState = petFollowStates.get(pet);
    
    if (followState) {
      // If already following this player, stop following
      if (followState.isFollowing && followState.targetPlayerId === playerEntity.player.id) {
        followState.isFollowing = false;
        followState.targetPlayerId = null;
        followState.targetEntity = null;
        
        // Reset to idle animation when stopped following
        // <<< ADDED check to skip animation for Doge Dog >>>
        if (pet.modelUri !== DIAMOND_PET_MODEL_URI) {
            if (petWalkAnimation) pet.stopModelAnimations([petWalkAnimation]);
            if (petIdleAnimation) pet.startModelLoopedAnimations([petIdleAnimation]);
        }
        
        world.chatManager.sendPlayerMessage(
          playerEntity.player, 
          `Pet stopped following you!`, 
          'FFAA00'
        );
      } 
      // Otherwise start following this player
      else {
        followState.isFollowing = true;
        followState.targetPlayerId = playerEntity.player.id;
        followState.targetEntity = playerEntity;
        
        // Immediately start movement animation when following begins
        // <<< ADDED check to skip animation for Doge Dog >>>
        if (pet.modelUri !== DIAMOND_PET_MODEL_URI) {
            if (petIdleAnimation) pet.stopModelAnimations([petIdleAnimation]);
            if (petWalkAnimation) pet.startModelLoopedAnimations([petWalkAnimation]);
        }
        
        world.chatManager.sendPlayerMessage(
          playerEntity.player, 
          `${petTypeName} started following you!`, 
          'FFAA00'
        );
      }
      
      // Increment and save global interaction counter
      totalInteractions++;
      updateGlobalStats();
    }
  };

  // --- Updated Egg Creation Function ---
  // Accepts model URI, initial position, AND egg type
  const createAndSpawnEgg = (modelUri: string, initialPosition: Vector3, eggType: EggType) => {
    // --- REMOVED Max Egg Check ---
    // if (activeEggs.size >= 10) { 
    //     console.warn("[WARN] Maximum number of eggs (10) reached. Not spawning new egg.");
    //     return;
    // }
    // --- END REMOVED ---
    console.log(`[DEBUG] createAndSpawnEgg called. Current activeEggs size: ${activeEggs.size}`); // Log map size (kept for info)

    console.log(`Creating and spawning new ${eggType} egg: ${modelUri} at:`, initialPosition);

    const newEggEntity = new Entity({
      modelUri: modelUri,
      rigidBodyOptions: {
        // Change type to KINEMATIC_VELOCITY to use velocity for movement and rotation
        type: RigidBodyType.KINEMATIC_VELOCITY,
        // Set angular velocity to make the egg spin around the Y-axis
        angularVelocity: { x: 0, y: EGG_ROTATE_SPEED, z: 0 }, 
      },
      modelScale: 0.9,
    });

    // Create the state object for this new egg
    const newEggState: EggState = {
      entity: newEggEntity, // Store entity reference
      basePosition: new Vector3(initialPosition.x, initialPosition.y, initialPosition.z), // Store a copy
      modelUri: modelUri,
      isOpening: false,
      openStartTime: null,
      openingPlayerId: null,
      animationTime: 0, // Reset animation timer
      eggType: eggType, // <<< Store the provided eggType
    };

    // Spawn the egg *before* adding its state to the map, as ID is assigned on spawn
    newEggEntity.spawn(world, initialPosition);
    console.log(`Egg ${newEggEntity.id} spawned successfully.`);

    // Add the new egg's state to the map using the numeric ID (use non-null assertion !)
    activeEggs.set(newEggEntity.id!, newEggState); 

    // Attach the TICK handler directly using the function reference
    newEggEntity.on(EntityEvent.TICK, handleEggTick); 
  };
  // --- End Updated Egg Creation Function ---

  // --- Function to spawn multiple eggs randomly ---
  const spawnEggs = (count: number, center: Vector3) => {
    console.log(`Spawning ${count} eggs around center:`, center);
    const availableEggTypes = [EggType.BASIC, EggType.SILVER]; // Include both egg types
    if (availableEggTypes.length === 0) {
        console.warn("No available egg types to spawn.");
        return; // Cannot spawn if no types are defined
    }

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * EGG_SPAWN_RADIUS;
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;
      const y = center.y + EGG_SPAWN_HEIGHT; // Spawn eggs higher up

      // Randomly choose an egg type from the available list
      const chosenEggType = availableEggTypes[Math.floor(Math.random() * availableEggTypes.length)];
      
      // Select the correct model based on the chosen type
      let chosenEggModel: string;
      switch (chosenEggType) {
        case EggType.SILVER:
          chosenEggModel = EGG_MODEL_SILVER;
          break;
        case EggType.BASIC:
        default:
          chosenEggModel = EGG_MODEL_BASIC;
          break;
      }

      // Call the single egg creation function with model AND type
      // chosenEggType is guaranteed to be defined here due to the check above
      createAndSpawnEgg(chosenEggModel, new Vector3(x, y, z), chosenEggType!);
    }
    console.log(`Finished request to spawn ${count} eggs.`);
  };

  // --- Define Egg Model/Position Constants ---
  // --- Original Egg ---
  const ORIGINAL_EGG_MODEL_URI = 'models/items/egg.glb';
  const ORIGINAL_EGG_BASE_POS = new Vector3(0.52, 5.0, 0.62); // Original egg position

  // --- Silver Egg ---
  const SILVER_EGG_MODEL_URI = 'models/items/silver-egg.glb'; // Path to silver egg model
  const SILVER_EGG_BASE_POS = new Vector3(-1.56, 5.0, -3.44); // Silver egg final position (Y adjusted to 5.0)

  // --- Golden Egg ---
  const GOLDEN_EGG_MODEL_URI = 'models/items/golden-egg.glb'; // Path to golden egg model
  const GOLDEN_EGG_BASE_POS = new Vector3(0.48, 5.0, -3.49); // Golden egg position (Y adjusted up)

  // --- Diamond Egg ---
  const DIAMOND_EGG_MODEL_URI = 'models/items/diamond-egg.glb'; // Path to diamond egg model
  const DIAMOND_EGG_BASE_POS = new Vector3(2.42, 5.0, -3.46); // Diamond egg position (Y adjusted up)


  // Initial spawn of ALL eggs
  createAndSpawnEgg(ORIGINAL_EGG_MODEL_URI, ORIGINAL_EGG_BASE_POS, EggType.BASIC);
  createAndSpawnEgg(SILVER_EGG_MODEL_URI, SILVER_EGG_BASE_POS, EggType.SILVER);
  createAndSpawnEgg(GOLDEN_EGG_MODEL_URI, GOLDEN_EGG_BASE_POS, EggType.GOLDEN);
  createAndSpawnEgg(DIAMOND_EGG_MODEL_URI, DIAMOND_EGG_BASE_POS, EggType.DIAMOND);

  // --- IMPORTS ---
  // ... other imports ...
  // ... CONSTANTS & GLOBALS ---
  // ... other constants ...
  const EGG_PROXIMITY_DISTANCE = 1.5; // How close player needs to be to show prompt

  // ... maps like playerEntities, playerScores, etc. ...

  // --- SETUP FUNCTION ---

  // --- Player Event Handling ---
  world.on(PlayerEvent.JOINED_WORLD, ({ player }: { player: Player }) => {
    // --- Create Player Entity ---
    // Aligning strictly with Hytopia documentation example
    const playerEntity = new PlayerEntity({
      player: player,
      name: player.username, // Use player's username for the name
      modelUri: 'models/players/player.gltf',
      modelLoopedAnimations: ['idle'],
      modelScale: 0.5,
    });
    playerEntity.spawn(world, new Vector3(-5, 5, 16));
    playerEntities.set(player.id, playerEntity);

    // --- ADDED: Set Collision Groups AFTER Spawning ---
    playerEntity.setCollisionGroupsForSolidColliders({
      belongsTo: [ COLLISION_GROUP_PLAYERS ],
      collidesWith: [
        CollisionGroup.BLOCK, // Collide with terrain
        CollisionGroup.ENTITY, // Collide with other default entities (if needed)
        // NOTE: Excludes COLLISION_GROUP_PETS
        CollisionGroup.ENTITY_SENSOR // Allow interacting with sensors
      ],
    });
    // --- END ADDED ---

    console.log(`Player ${player.username} (${player.id}) joined.`);

    // --- Initialize Score & Leaderboard ---
    if (!playerScores.has(player.id)) {
        playerScores.set(player.id, 0);
        updateLeaderboard();
    }

    // --- ADDED: Initialize Multiplier & Check Pets ---
    let initialMultiplier = 1.0;
    const sessionPets = playerSessionPets.get(player.id) || [];
    const hasRabbitPet = sessionPets.some(pet => 
        pet.type.toLowerCase() === 'rabbit' && 
        pet.rarity === EggType.BASIC
    );

    if (hasRabbitPet) {
        console.log(`[Multiplier] Player ${player.username} joined with Basic Rabbit. Setting multiplier to 1.5x`);
        initialMultiplier = 1.5;
    } else {
        console.log(`[Multiplier] Player ${player.username} joined without Basic Rabbit. Setting multiplier to 1.0x`);
    }
    playerMultipliers.set(player.id, initialMultiplier);
    updateLeaderboard(); // Update leaderboard now that score and multiplier are set
    // --- END ADDED ---

    // --- Load Player Main UI ---
    player.ui.load('ui/index.html'); 

    // --- Assign Tower Location and Initialize Tower Logic ---
    if (nextTowerIndex >= towerBaseLocations.length) {
      console.warn(`Maximum tower slots reached. Player ${player.username} will not get a tower.`);
    } else {
      const assignedLocation = towerBaseLocations[nextTowerIndex];
      if (assignedLocation) {
        console.log(`Assigning tower location ${nextTowerIndex} to player ${player.username}:`, assignedLocation.center);

        // Initialize Tower State for this player
        playerBlockResources.set(player.id, 0);
        playerTowerData.set(player.id, {
          location: assignedLocation,
          currentY: assignedLocation.center.y,
          layerIndex: 0,
          isHovering: false, // <<< ADDED: Initialize hover state
        });
        nextTowerIndex++;

        // Create and store Tower Scene UIs for this player
        const floorDisplayUI = new SceneUI({
          templateId: 'tower-floor-display',
          attachedToEntity: playerEntity,
          offset: new Vector3(0, 1.3, 0),
          state: { floor: 1 }
        });
        floorDisplayUI.load(world);
        playerFloorDisplayUIs.set(player.id, floorDisplayUI);

        const blockCounterUI = new SceneUI({
          templateId: 'block-counter',
          position: new Vector3(assignedLocation.center.x, assignedLocation.center.y + 15, assignedLocation.center.z),
          state: { blockCount: 0, blockRate: '+1 Block/s' }
        });
        blockCounterUI.load(world);
        playerBlockCounterUIs.set(player.id, blockCounterUI);

        // Start Automatic Block Generation Interval for this player
        const blockGenerationInterval = setInterval(() => {
          const currentResources = playerBlockResources.get(player.id) ?? 0;
          playerBlockResources.set(player.id, currentResources + 1);
          const counterUI = playerBlockCounterUIs.get(player.id);
          if (counterUI) {
            counterUI.setState({
              blockCount: currentResources + 1,
              blockRate: '+1 Block/s'
            });
          }
        }, 1000);
        playerBlockIntervals.set(player.id, blockGenerationInterval);

        // --- MODIFIED: Start tower building using the new function --- 
        startOrUpdateTowerBuilding(player.id);
        // --- END MODIFIED --- 

      } else {
        console.error(`Error: assignedLocation was unexpectedly undefined for player ${player.username} at index ${nextTowerIndex}`);
      }
    }
    // --- End Tower Assignment Logic ---

    // --- Listen for UI Data (Teleport, Pet Interactions, etc.) ---
    player.ui.on(PlayerUIEvent.DATA, ({ playerUI, data }) => {
      const currentPlayerId = playerUI.player.id;
      const currentPlayerEntity = playerEntities.get(currentPlayerId);

      if (!currentPlayerEntity) {
        console.warn(`Received UI data from player ${currentPlayerId} but their entity was not found.`);
        return;
      }

      // Handle Tower Teleport Request
      if (data && data.type === 'requestTowerTeleport') {
          console.log("--- [DEBUG] Server received requestTowerTeleport ---"); // <<< ADDED LOG
          console.log(`Received teleport request from ${playerUI.player.username}`);
          const towerData = playerTowerData.get(currentPlayerId); // Get player's tower data

          if (towerData) { // Check if player has tower data
            // --- MODIFIED: Teleport and Hover Logic ---
            // Calculate the Y level of the topmost block
            // If layerIndex is 0, the last layer was just completed, so the top is currentY - 1
            // Otherwise, the top is currentY
            const topBlockY = towerData.layerIndex === 0 && towerData.currentY > towerData.location.center.y
                                ? towerData.currentY - 1
                                : towerData.currentY;

            // Calculate the teleport destination slightly above the center of the tower top
            const teleportY = topBlockY + 1.5; // Adjust Y offset as needed for hover height
            const teleportDestination = new Vector3(towerData.location.center.x, teleportY, towerData.location.center.z);

            console.log("--- [DEBUG] Attempting to teleport player... ---"); // <<< ADDED LOG
            console.log(`Teleporting and hovering ${playerUI.player.username} to ${teleportDestination.x.toFixed(2)}, ${teleportDestination.y.toFixed(2)}, ${teleportDestination.z.toFixed(2)}`);
            
            // Use playerEntity.teleport() for smoother transition
            // <<< FIX: Use setPosition instead of teleport >>>
            currentPlayerEntity.setPosition(teleportDestination);
            // Set the hovering state for this player
            towerData.isHovering = true; 
            currentPlayerEntity.rawRigidBody?.setGravity(0); // <<< MODIFIED: Try on rawRigidBody
            console.log("--- [DEBUG] SetPosition call finished. Hover state set to true. Gravity Scale set to 0. ---"); // <<< UPDATED LOG
            playerTowerData.set(currentPlayerId, towerData); // Save the updated state
            // --- END MODIFIED ---
          } else {
            console.warn(`Player ${playerUI.player.username} requested teleport but has no assigned tower.`);
            // Maybe send a chat message back?
             player.ui.sendData({ type: 'teleportFailed', reason: 'No tower assigned' });
          }
      }
      // Handle Pet Interaction Requests
      else if (data && data.type === 'requestPetInteraction') {
          console.log(`Received pet interaction request from ${playerUI.player.username}`);
          // Find the closest pet to the player
          let closestPet: Entity | null = null;
          let minDistance = Infinity;

          // <<< Updated check to include Payload Bomb >>>
          const allowedPetModels = [BASIC_PET_MODEL_URI, SILVER_PET_MODEL_URI, GOLDEN_PET_MODEL_URI, DIAMOND_PET_MODEL_URI]; 

          for (const pet of petFollowStates.keys()) {
            // Ensure pet.modelUri is defined before checking
            if (pet.modelUri && allowedPetModels.includes(pet.modelUri)) { 
              const distance = calculateDistance(currentPlayerEntity.position, pet.position);
              if (distance < minDistance && distance <= 3) { // Check if within interactable range (e.g., 3 units)
                minDistance = distance;
                closestPet = pet;
              }
            }
          }

          if (closestPet) {
            console.log(`Player ${playerUI.player.username} interacted with pet ${closestPet.id}`);
            // Perform interaction logic (e.g., play sound, particle effect, increment counter)

            // Increment global interaction counter
            totalInteractions++;
            console.log(`Total interactions: ${totalInteractions}`);
            updateGlobalStats(); // Save and broadcast updated stats

             // Play a sound effect at the pet's location
            const interactSound = new Audio({
                uri: 'audio/sfx/interaction.mp3', // Specific interaction sound
                position: closestPet.position,
                volume: 0.8,
            });
            interactSound.play(world);

            // TODO: Add particle effect if desired

          } else {
            console.log(`Player ${playerUI.player.username} tried to interact, but no pet was close enough.`);
            // Optionally send feedback to the player's UI
            // playerUI.sendData({ type: 'interactionFailed', reason: 'No pet nearby' });
          }
      }
      // Handle Egg Claim Request
      else if (data && data.type === 'claimEgg') {
        console.log(`Player ${playerUI.player.username} trying to claim egg with ID: ${data.eggId}`); // Log the ID from data
        tryClaimEgg(player.id, data.eggId); // Call the placeholder function
      }
    });
    // --- End Listen for UI Data --

    // --- MODIFIED: Player Input Tick Handler ---
    // PlayerEntity by default has a PlayerEntityController assigned to .controller,
    // but we explicitly assert that with ! to prevent typescript from complaining.
    playerEntity.controller!.on(BaseEntityControllerEvent.TICK_WITH_PLAYER_INPUT, ({ entity, input, cameraOrientation, deltaTimeMs }) => {
      
      // --- ADDED: Deactivate Hover on Movement ---
      const towerData = playerTowerData.get(player.id);
      if (towerData?.isHovering) {
          // Check for any movement input
          if (input.w || input.a || input.s || input.d || input.sp) {
              console.log(`Player ${player.username} moved while hovering. Disabling hover.`);
              towerData.isHovering = false;
              entity.rawRigidBody?.setGravity(1); // <<< ADDED: Re-enable gravity
              playerTowerData.set(player.id, towerData); // Save the updated state
          }
      }
      // --- END ADDED ---

      // --- Centralized Egg Prompt Logic (Remove Debug Logs) ---
      let closestEggState: EggState | null = null;
      let minDistanceSq = EGG_PROMPT_DISTANCE * EGG_PROMPT_DISTANCE; 

      for (const eggState of activeEggs.values()) {
        if (!eggState.isOpening) {
          const dx = entity.position.x - eggState.entity.position.x;
          const dy = entity.position.y - eggState.entity.position.y;
          const dz = entity.position.z - eggState.entity.position.z;
          const distanceSq = dx * dx + dy * dy + dz * dz;
          if (distanceSq <= minDistanceSq) {
            minDistanceSq = distanceSq;
            closestEggState = eggState;
          }
        }
      }
      
      const newVisiblePromptType: EggType | null = closestEggState ? closestEggState.eggType : null;
      const currentVisiblePromptType = playerVisiblePrompt.get(player.id);

      if (newVisiblePromptType !== currentVisiblePromptType) {
        // Hide the old prompt if one was visible
        if (currentVisiblePromptType) {
          const hideMessageType = `update${capitalizeFirstLetter(currentVisiblePromptType)}EggPrompt`;
          player.ui.sendData({ type: hideMessageType, visible: false });
        }
        // Show the new prompt if one is now visible
        if (newVisiblePromptType) {
          const showMessageType = `update${capitalizeFirstLetter(newVisiblePromptType)}EggPrompt`;
          // --- MODIFIED: Send cost along with visibility --- 
          let cost = 0;
          switch (newVisiblePromptType) {
            case EggType.BASIC:
              cost = COST_EGG_BASIC;
              break;
            case EggType.SILVER:
              cost = COST_EGG_SILVER;
              break;
            case EggType.GOLDEN:
              cost = COST_EGG_GOLDEN;
              break;
            case EggType.DIAMOND:
              cost = COST_EGG_DIAMOND;
              break;
          }
          player.ui.sendData({ type: showMessageType, visible: true, cost: cost }); // Send cost
          // --- END MODIFIED ---
        }
        playerVisiblePrompt.set(player.id, newVisiblePromptType);
      }
      // --- End Centralized Egg Prompt Logic --- 

      // --- Existing F Key Interaction Logic (Uses the already found closestEggState) ---
      if (input.f && !playerEPressedState.get(player.id)) {
        playerEPressedState.set(player.id, true); // Mark as handled for this press down

        console.log(`Player ${player.username} pressed F`); // Debug log

        // Use the closestEggState determined by the proximity check above
        // No need to recalculate distance here, just check if an egg was found and its type
        if (closestEggState) { 
          // Check if the closest egg (already determined to be within range) can be opened
          if (closestEggState.eggType === EggType.BASIC) {
            // Check if player has enough points for basic egg
            const cost = COST_EGG_BASIC; // Use constant
            const eggTypeName = "Basic";
            const currentScore = playerScores.get(player.id) || 0;
            if (currentScore < cost) {
              // Not enough points - send message to player
              world.chatManager.sendPlayerMessage(
                player,
                `You need ${cost} points to open a ${eggTypeName} egg! Current points: ${currentScore}`,
                'FF0000' // Red color for error
              );
              return;
            }

            // Deduct points and update score
            const newScore = currentScore - cost;
            playerScores.set(player.id, newScore);
            updateLeaderboard(); // Update the leaderboard to reflect new score

            // --- LOGGING: Calling decreaseTowerHeight --- 
            console.log(`[PointDeduct][CALLING DECREASE] Player: ${player.username} (${player.id}), Blocks to Remove: ${cost}`);

            // --- ADDED: Decrease tower height ---
            decreaseTowerHeight(player.id, cost); // Remove blocks for the egg cost

            console.log(`Player ${player.username} starting to open ${closestEggState.eggType} egg ${closestEggState.entity.id}`);
            closestEggState.isOpening = true;
            closestEggState.openStartTime = Date.now();
            closestEggState.openingPlayerId = player.id;

            // Play an opening sound effect at the egg's location
            const openSound = new Audio({
              uri: 'audio/sfx/egg_open_start.mp3',
              position: closestEggState.entity.position,
              volume: 0.7,
            });
            openSound.play(world);

            // Send message confirming point deduction
            world.chatManager.sendPlayerMessage(
              player,
              `Spent ${cost} points to open ${eggTypeName} egg. Remaining points: ${newScore}`,
              'FFAA00' // Orange/gold color for info
            );
          } else if (closestEggState.eggType === EggType.SILVER || closestEggState.eggType === EggType.GOLDEN || closestEggState.eggType === EggType.DIAMOND) {
            let cost = 0;
            let eggTypeName = "";
            switch (closestEggState.eggType) {
              case EggType.SILVER:
                cost = COST_EGG_SILVER; // Use constant
                eggTypeName = "Silver";
                break;
              case EggType.GOLDEN:
                cost = COST_EGG_GOLDEN; // Use constant
                eggTypeName = "Golden";
                break;
              case EggType.DIAMOND:
                cost = COST_EGG_DIAMOND; // Use constant
                eggTypeName = "Diamond";
                break;
            }

            // Check if player has enough points
            const currentScore = playerScores.get(player.id) || 0;
            if (currentScore < cost) {
              // Not enough points - send message
              world.chatManager.sendPlayerMessage(
                player,
                `You need ${cost} points to open a ${eggTypeName} egg! Current points: ${currentScore}`,
                'FF0000' // Red color for error
              );
              return; // Stop interaction
            }

            // Deduct points and update score
            const newScore = currentScore - cost;
            playerScores.set(player.id, newScore);
            updateLeaderboard(); // Update the leaderboard

            // Decrease tower height
            decreaseTowerHeight(player.id, cost); // Remove blocks equivalent to cost
            
            // Send confirmation message
            world.chatManager.sendPlayerMessage(
              player,
              `Spent ${cost} points to open ${eggTypeName} egg. Remaining points: ${newScore}`,
              'FFAA00' // Orange/gold color for info
            );

            console.log(`Player ${player.username} starting to open ${closestEggState.eggType} egg ${closestEggState.entity.id}`); 
            closestEggState.isOpening = true;
            closestEggState.openStartTime = Date.now();
            closestEggState.openingPlayerId = player.id;

            // Play an opening sound effect at the egg's location
            const openSound = new Audio({
              uri: 'audio/sfx/egg_open_start.mp3',
              position: closestEggState.entity.position,
              volume: 0.7,
            });
            openSound.play(world);
          } else {
            // Log if the player tried to open an egg of an unsupported type with 'F'
            console.log(`Player ${player.username} tried to open egg ${closestEggState.entity.id} of type ${closestEggState.eggType}, which is not supported by F key.`);
          }
        } else {
          console.log(`Player ${player.username} pressed F, but no interactable egg was nearby.`); // Debug log
        }

      } else if (!input.f) {
        // Reset the pressed state when the key is released
        playerEPressedState.set(player.id, false);
      }
      // --- End F Key Interaction Logic ---
      
      // --- Tower Placement Logic (Raycasting) ---
      if (input.ml || input.mr) {
        // ... (Existing raycast block break/place logic - unchanged) ...
         const origin = entity.position; 
         const direction = entity.player.camera.facingDirection; 
         const length = 5;
         const raycastResult = world.simulation.raycast(origin, direction, length, {
           filterExcludeRigidBody: playerEntity.rawRigidBody, 
         });

         if (raycastResult?.hitBlock) { 
           if (input.ml) { 
             const breakPosition = raycastResult.hitBlock.globalCoordinate;
             world.chunkLattice.setBlock(breakPosition, 0); 
           } else { 
             const placePosition = raycastResult.hitBlock.getNeighborGlobalCoordinateFromHitPoint(raycastResult.hitPoint);
             
             // --- Tower Building Integration ---
             const towerState = playerTowerData.get(player.id);
             if (towerState && (playerBlockResources.get(player.id) ?? 0 > 0)) { // Check if player has resources
                 const towerBaseX = towerState.location.center.x - towerState.location.width / 2;
                 const towerBaseZ = towerState.location.center.z - towerState.location.depth / 2;

                 // Check if the placement position is within the player's designated tower area
                 if (towerState &&
                     placePosition.x >= towerBaseX && 
                     placePosition.x < towerBaseX + towerState.location.width &&
                     placePosition.z >= towerBaseZ && 
                     placePosition.z < towerBaseZ + towerState.location.depth &&
                     placePosition.y >= towerState.location.center.y) { // Allow building upwards from base

                     // Place the block (use wood for now)
                     world.chunkLattice.setBlock(placePosition, WOOD_BLOCK_ID);
                     
                     // Deduct resource
                     const currentBlocks = playerBlockResources.get(player.id) ?? 0;
                     playerBlockResources.set(player.id, currentBlocks - 1);

                     // Check if this completes a layer and update tower state
                     // This requires tracking blocks placed per layer - simplified for now
                     // updateTowerProgress(player.id, placePosition.y); 

                 } else {
                    // Optional: Send message that they can't build here
                    // world.chatManager.sendPlayerMessage(player, "You can only build within your tower area!", 'FF0000');
                 }
             } else {
                // Optional: Send message if out of resources
                // world.chatManager.sendPlayerMessage(player, "You need more blocks!", 'FFCC00');
             }
             // --- End Tower Building Integration ---
           }
         }

         input.ml = false;
         input.mr = false;
      }
      // --- End Tower Placement Logic ---

    }); // End TICK_WITH_PLAYER_INPUT listener
    // --- End Player Input Tick Handler ---
    
    // Initialize the visible prompt state for this player
    playerVisiblePrompt.set(player.id, null);

    // Set up pet locker UI data handler
    player.ui.on(PlayerUIEvent.DATA, ({ data }) => {
      console.log(`[DEBUG] Received UI data from player ${player.username}:`, data);
      
      if (data.type === 'requestOwnedPets') {
        // Get session pets for this player
        const playerPets = playerSessionPets.get(player.id) || [];
        console.log(`[DEBUG] Sending ${playerPets.length} session pets to player ${player.username}`);
        
        // Send the session pets to the UI
        player.ui.sendData({
          type: 'updateOwnedPets',
          pets: playerPets
        });
      }
      else if (data.type === 'deletePet') {
        // Handle pet deletion
        const persistentIdToDelete = data.persistentId;
        const playerId = player.id; // Get the player ID
        console.log(`[DEBUG] Handling pet deletion request for Player: ${playerId}, Pet PersistentID: ${persistentIdToDelete}`);
        
        // --- ADDED: Find and Despawn Entity --- 
        let entityToDespawn: Entity | undefined = undefined;
        let entityIdToDelete: number | undefined = undefined;

        // Iterate through the map to find the runtime entity ID
        for (const [entityId, storedPersistentId] of entityIdToPersistentIdMap.entries()) {
          if (storedPersistentId === persistentIdToDelete) {
            entityIdToDelete = entityId;
            entityToDespawn = world.entityManager.getEntity(entityId); // <<< CORRECTED: Use getEntity
            break; // Found the entity ID
          }
        }

        // If we found the entity, despawn it and clean up maps
        if (entityToDespawn && entityIdToDelete !== undefined) {
          console.log(`[DEBUG] Found entity ${entityIdToDelete} matching persistent ID ${persistentIdToDelete}. Despawning...`);
          entityToDespawn.despawn();
          entityIdToPersistentIdMap.delete(entityIdToDelete); // Remove from ID mapping
          petFollowStates.delete(entityToDespawn); // Remove from follow states if present
          console.log(`[DEBUG] Entity ${entityIdToDelete} despawned and maps cleaned.`);
        } else {
          console.warn(`[WARN] Could not find active entity in world for persistent ID ${persistentIdToDelete} to despawn.`);
        }
        // --- END ADDED --- 
        
        // Get the player's session pets (existing logic)
        const playerPets = playerSessionPets.get(playerId);
        if (!playerPets) {
          console.log(`[DEBUG] No session pets found for player ${player.username}`);
          player.ui.sendData({ 
            type: 'petDeleteFailed', 
            persistentId: persistentIdToDelete, 
            reason: 'No pets found'
          });
          return;
        }
        
        // Find the pet to delete
        const petIndex = playerPets.findIndex(pet => pet.persistentId === persistentIdToDelete);
        if (petIndex === -1) {
          console.log(`[DEBUG] Pet ID ${persistentIdToDelete} not found in session storage`);
          player.ui.sendData({ 
            type: 'petDeleteFailed', 
            persistentId: persistentIdToDelete, 
            reason: 'Pet not found'
          });
          return;
        }
        
        // Remove the pet from session storage
        playerPets.splice(petIndex, 1);
        console.log(`[DEBUG] Removed pet from session storage. Player now has ${playerPets.length} pets`);
        
        // --- ADDED: Recalculate multiplier after deletion ---
        console.log(`[Multiplier] Triggering multiplier recalculation for ${playerId} after deleting pet ${persistentIdToDelete}`);
        calculateAndUpdateMultiplier(playerId);
        // --- END ADDED ---

        // Send confirmation back to the UI
        player.ui.sendData({ 
          type: 'petDeleteConfirmed', 
          persistentId: persistentIdToDelete 
        });
        
        // Also send the updated pet list
        player.ui.sendData({
          type: 'updateOwnedPets',
          pets: playerPets
        });
      }
    });

    // --- MODIFIED: Calculate Initial Multiplier and Start Building AFTER other setup ---
    console.log(`[Multiplier] Calculating initial multiplier for ${player.username} (${player.id})`);
    calculateAndUpdateMultiplier(player.id); // Calculate based on any pre-existing/loaded pets
    // startOrUpdateTowerBuilding is called inside calculateAndUpdateMultiplier if the multiplier changes
    // If it doesn't change from default, we still need to start it:
    if (!playerBlockIntervals.has(`tower_${player.id}`)) { 
      // console.log(`[TowerBuild] Manually starting initial tower build for ${player.username} as multiplier didn't change from default.`); // <<< COMMENTED OUT
      startOrUpdateTowerBuilding(player.id);
    }
    // --- END MODIFIED ---

  }); // End JOINED_WORLD

  world.on(PlayerEvent.LEFT_WORLD, ({ player }: { player: Player }) => {
    console.log(`Player ${player.username} (${player.id}) left the world.`);
    
    // --- ADDED: Cleanup Visible Prompt State ---
    // Hide any prompt that might have been visible for the leaving player
    const lastVisiblePrompt = playerVisiblePrompt.get(player.id);
    if (lastVisiblePrompt) {
      const messageType = `update${capitalizeFirstLetter(lastVisiblePrompt)}EggPrompt`;
      // We can't send UI data *after* the player has left, 
      // but we clean up the server state.
      // console.log(`[UI PROMPT] Cleaning up prompt state for leaving player ${player.id}`); 
    }
    playerVisiblePrompt.delete(player.id); // Remove from map
    // --- END ADDED ---

    // --- Cleanup player entity ---
    const playerEntity = playerEntities.get(player.id);
    if (playerEntity && playerEntity.rawRigidBody) { // Check if rawRigidBody exists
      // --- ADDED: Reset gravity scale on leave ---
      // --- FIX: Attempt to set gravityScale property directly on rawRigidBody ---
      playerEntity.rawRigidBody.gravityScale = 1;
      // --- END FIX ---
      // --- END ADDED ---
      playerEntity.despawn();
      playerEntities.delete(player.id);
    }

    // --- Stop and cleanup intervals ---
    const blockIntervalId = playerBlockIntervals.get(player.id);
    if (blockIntervalId) {
      clearInterval(blockIntervalId);
      playerBlockIntervals.delete(player.id);
    }
    const towerIntervalId = playerBlockIntervals.get(`tower_${player.id}`);
    if (towerIntervalId) {
      clearInterval(towerIntervalId);
      playerBlockIntervals.delete(`tower_${player.id}`);
    }

    // --- Cleanup tower state --- 
    playerBlockResources.delete(player.id);
    playerTowerData.delete(player.id); // Use the new map name

    // --- Cleanup UI state --- 
    const floorUI = playerFloorDisplayUIs.get(player.id);
    if (floorUI) {
      floorUI.unload();
      playerFloorDisplayUIs.delete(player.id);
    }
    const counterUI = playerBlockCounterUIs.get(player.id);
    if (counterUI) {
      counterUI.unload();
      playerBlockCounterUIs.delete(player.id);
    }

    // Cleanup pet interactions if the player was being followed
    for (const [pet, followState] of petFollowStates.entries()) {
      if (followState.targetPlayerId === player.id) {
        followState.isFollowing = false;
        followState.targetPlayerId = null;
        followState.targetEntity = null;
        // Reset pet to idle animation based on its type
        // <<< UPDATED check to include skipping Doge Dog >>>
        if (pet.modelUri === BASIC_PET_MODEL_URI) {
          if (BASIC_PET_WALK_ANIMATION) pet.stopModelAnimations([BASIC_PET_WALK_ANIMATION]);
          if (BASIC_PET_IDLE_ANIMATION) pet.startModelLoopedAnimations([BASIC_PET_IDLE_ANIMATION]);
        } else if (pet.modelUri === SILVER_PET_MODEL_URI) {
          if (SILVER_PET_WALK_ANIMATION) pet.stopModelAnimations([SILVER_PET_WALK_ANIMATION]);
          if (SILVER_PET_IDLE_ANIMATION) pet.startModelLoopedAnimations([SILVER_PET_IDLE_ANIMATION]);
        } else if (pet.modelUri === GOLDEN_PET_MODEL_URI) {
          if (GOLDEN_PET_WALK_ANIMATION) pet.stopModelAnimations([GOLDEN_PET_WALK_ANIMATION]);
          if (GOLDEN_PET_IDLE_ANIMATION) pet.startModelLoopedAnimations([GOLDEN_PET_IDLE_ANIMATION]);
        } // <<< No else if needed for DIAMOND/Doge, as it has no animations to stop/start >>>
      }
    }
    
    // Cleanup interaction state
    playerEPressedState.delete(player.id);
    playerEPressedState.delete(`prompt_${player.id}`); // Clean up prompt visibility state tracking

    // Update leaderboard after player leaves
    playerScores.delete(player.id);
    updateLeaderboard();

    console.log(`[DEBUG] Player left, cleaning up session pets`);
    playerSessionPets.delete(player.id);
  });

  // Helper function to capitalize first letter (used for message types)
  function capitalizeFirstLetter(str: string): string {
      if (!str) return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // --- Function to decrease tower height ---
  const decreaseTowerHeight = (playerId: string, blocksToRemove: number) => {
    // --- LOGGING: Function Entry --- 
    console.log(`[DecreaseTower][ENTRY] PlayerID: ${playerId}, BlocksToRemove: ${blocksToRemove}`);

    const towerData = playerTowerData.get(playerId);
    if (!towerData) {
      // --- LOGGING: No Tower Data Found --- 
      console.error(`[DecreaseTower][ERROR] No tower data found for PlayerID: ${playerId}`);
      return;
    }

    // --- LOGGING: Tower Data Retrieved --- 
    console.log(`[DecreaseTower][DATA] PlayerID: ${playerId}, Tower Center: (${towerData.location.center.x}, ${towerData.location.center.y}, ${towerData.location.center.z}), CurrentY: ${towerData.currentY}, LayerIndex: ${towerData.layerIndex}`);

    // Calculate how many full layers we need to remove
    const { width, depth } = towerData.location;
    const blocksPerLayer = width * depth;
    let remainingBlocks = blocksToRemove;

    // Loop while there are blocks left to remove AND we are at or above the base Y level
    while (remainingBlocks > 0 && towerData.currentY >= towerData.location.center.y) { 
      
      // If layerIndex is 0 AND we are ABOVE the base, adjust down.
      if (towerData.layerIndex === 0 && towerData.currentY > towerData.location.center.y) {
        towerData.currentY--; 
        towerData.layerIndex = blocksPerLayer; 
        console.log(`[DecreaseTower][ADJUST] PlayerID: ${playerId}, LayerIndex was 0. Moved down to Y: ${towerData.currentY}, set LayerIndex to ${towerData.layerIndex}`);
        
        // Re-check if we are now below the base (shouldn't happen with >= loop condition, but safe check)
        if (towerData.currentY < towerData.location.center.y) {
            console.log(`[DecreaseTower][ADJUST] PlayerID: ${playerId}, Hit below base after adjustment. Breaking loop.`);
            break; 
        }
      }
      // Special case: If we start an iteration ON the base layer with index 0, the tower is empty.
      else if (towerData.layerIndex === 0 && towerData.currentY === towerData.location.center.y) {
        console.log(`[DecreaseTower] Tower is empty (Base Y and Index 0). Stopping removal.`);
        if (remainingBlocks > 0) {
           console.warn(`[DecreaseTower] Requested removal (${blocksToRemove}) when tower was already empty.`);
        }
        remainingBlocks = 0; // Mark as done
        break;
      }
      
      // Determine blocks on the current layer (layerIndex can't be 0 here unless tower is empty)
      const blocksOnThisLayer = towerData.layerIndex; 

      // --- Logic for Full vs Partial Layer Removal ---
      if (remainingBlocks >= blocksOnThisLayer) {
        // --- Remove FULL Current Layer --- 
        console.log(`[DecreaseTower][FULL LAYER] PlayerID: ${playerId}, Removing layer at Y: ${towerData.currentY}, Blocks: ${blocksOnThisLayer}`);
        
        // --- MODIFIED: Iterate backwards for removal ---
        const startIndex = blocksOnThisLayer - 1; // Start from the last placed block index
        const endIndex = 0; // End at the first block index
        
        for (let i = startIndex; i >= endIndex; i--) { // Loop backwards (>= 0)
          // ... (coordinate calculation and setBlock - calculation logic remains the same) ...
          const layerX = i % width;
          const layerZ = Math.floor(i / width);
          const blockX = Math.floor(towerData.location.center.x - (width / 2 - 0.5) + layerX);
          // const blockY = towerData.currentY; // Use the potentially updated Y // <<< REMOVED Unused Variable
          const blockZ = Math.floor(towerData.location.center.z - (depth / 2 - 0.5) + layerZ);
          // const isCorner = (layerX === 0 || layerX === towerWidth - 1) && (layerZ === 0 || layerZ === towerDepth - 1); // <<< REMOVED Incorrect Logic
          // const blockTypeId = isCorner ? STONE_BLOCK_ID : WOOD_BLOCK_ID; // <<< REMOVED Incorrect Logic
          // const flooredX = Math.floor(blockX); // <<< REMOVED Redundant Floor
          // const flooredZ = Math.floor(blockZ); // <<< REMOVED Redundant Floor
          // const targetBlockPos = new Vector3(flooredX, blockY, flooredZ); // <<< REMOVED Incorrect Logic

          // Place the actual block
          // world.chunkLattice.setBlock(targetBlockPos, blockTypeId); // <<< REMOVED Incorrect Logic
          // pointsAwardedThisTick++; // Count this block/point // <<< REMOVED Incorrect Logic

          // Update tower state for the *next* iteration or tick
          // towerData.layerIndex++;  // <<< REMOVED Incorrect Logic
          
          // Spawn visual effect (optional, can be kept or removed)
          // <<< REMOVED Orb Spawning Logic Start >>>
          // const playerEntity = playerEntities.get(playerId);
          // if (playerEntity) {
          //     const startPos = new Vector3(playerEntity.position.x, playerEntity.position.y + 0.5, playerEntity.position.z);
          //     const endPos = new Vector3(targetBlockPos.x + 0.5, targetBlockPos.y + 0.5, targetBlockPos.z + 0.5);
          //     // Orb logic unchanged...
          //     const travelDuration = 0.3;
          //     const direction = new Vector3(endPos.x - startPos.x, endPos.y - startPos.y, endPos.z - startPos.z);
          //     const distance = direction.length;
          //     direction.normalize(); 
          //     const speed = distance / travelDuration;
          //     const velocity = new Vector3(direction.x * speed, direction.y * speed, direction.z * speed);
          //     const orbVisual = new Entity({
          //       modelUri: 'models/projectiles/energy-orb-projectile.gltf',
          //       modelScale: 0.3, 
          //       rigidBodyOptions: {
          //         type: RigidBodyType.KINEMATIC_VELOCITY, 
          //         linearVelocity: velocity, 
          //         colliders: [{ shape: ColliderShape.BALL, radius: 0.2, isSensor: true }]
          //       }
          //     });
          //     orbVisual.spawn(world, startPos);
          //     setTimeout(() => { orbVisual.despawn(); }, travelDuration * 1000);        
          // }
          // <<< REMOVED Orb Spawning Logic End >>>

          // <<< RESTORED: Set block to air >>>
          console.log(`[DecreaseTower][SET AIR - Full] PlayerID: ${playerId}, Index: ${i}, Coords: (${blockX}, ${towerData.currentY}, ${blockZ})`); // Added Index to log
          world.chunkLattice.setBlock(new Vector3(blockX, towerData.currentY, blockZ), 0); // 0 = air
        }
        // --- END MODIFIED ---

        remainingBlocks -= blocksOnThisLayer;

        // Check if we just cleared the base layer
        if (towerData.currentY === towerData.location.center.y) {
            towerData.layerIndex = 0; // Mark tower as empty
            console.log(`[DecreaseTower] Cleared base layer. Tower is now empty.`);
            if (remainingBlocks > 0) {
                 console.warn(`[DecreaseTower] Requested removal (${blocksToRemove}) exceeded tower height. Removed ${blocksToRemove - remainingBlocks} blocks.`);
                 remainingBlocks = 0; // Stop further attempts
            }
            // Don't decrement currentY below base
        } else {
             // We cleared a layer above the base, set index to 0 to trigger adjustment next loop
             towerData.layerIndex = 0;
             // currentY will be decremented by the adjustment logic in the next iteration if needed
        }

      } else {
        // --- Remove PARTIAL Current Layer --- 
        console.log(`[DecreaseTower][PARTIAL LAYER] PlayerID: ${playerId}, Removing ${remainingBlocks} blocks from layer at Y: ${towerData.currentY}, Current Index: ${towerData.layerIndex}`);
        
        const startIndex = towerData.layerIndex - 1;
        const endIndex = towerData.layerIndex - remainingBlocks;
        
        for (let i = startIndex; i >= endIndex; i--) {
           // ... (coordinate calculation and setBlock) ...
          const layerX = i % width;
          const layerZ = Math.floor(i / width);
          const blockX = Math.floor(towerData.location.center.x - (width / 2 - 0.5) + layerX);
          const blockZ = Math.floor(towerData.location.center.z - (depth / 2 - 0.5) + layerZ);
          console.log(`[DecreaseTower][SET AIR - Partial] PlayerID: ${playerId}, Coords: (${blockX}, ${towerData.currentY}, ${blockZ})`);
          world.chunkLattice.setBlock(new Vector3(blockX, towerData.currentY, blockZ), 0);
        }

        towerData.layerIndex -= remainingBlocks;
        remainingBlocks = 0; // Partial removal always finishes the job
      }
    }

    // Final check for leftover blocks (should only happen if tower was shorter than requested removal)
    if (remainingBlocks > 0) {
         console.warn(`[DecreaseTower][WARN] PlayerID: ${playerId} - Requested removal (${blocksToRemove}) might have exceeded actual tower height. ${remainingBlocks} blocks could not be removed.`);
    }

    // --- Update UI & Save State --- 
    const floorDisplayUI = playerFloorDisplayUIs.get(playerId);
    if (floorDisplayUI) {
      const currentFloor = Math.max(1, towerData.currentY - towerData.location.center.y + 1); // Ensure floor doesn't go below 1
      floorDisplayUI.setState({ floor: currentFloor });
    }
    console.log(`[DecreaseTower][SAVE] PlayerID: ${playerId}, New CurrentY: ${towerData.currentY}, New LayerIndex: ${towerData.layerIndex}`);
    playerTowerData.set(playerId, towerData);
  };

  // --- Multiplier Constants --- 
  const MULTIPLIER_DEFAULT = 1.0;
  const MULTIPLIER_CHICKEN = 1.0; 
  const MULTIPLIER_RABBIT = 1.5;
  const MULTIPLIER_PIG = 1.7;
  const MULTIPLIER_COW = 2.2;   // Silver
  const MULTIPLIER_BAT = 2.5;    // Silver
  const MULTIPLIER_SHEEP = 2.6;  // Silver
  const MULTIPLIER_DONKEY = 4.3; // Golden
  const MULTIPLIER_SQUID = 4.4;  // Golden
  const MULTIPLIER_OCELOT = 4.7; // Golden
  const MULTIPLIER_SPIDER = 10.0; // Diamond
  const MULTIPLIER_PAYLOAD_BOMB = 10.5; // Diamond
  const MULTIPLIER_DD = 20.0; // Diamond (Doge Dog)
  // Add constants for other pets later if needed

  // ... existing code ...

  // --- ADDED: Function to calculate and apply the highest applicable multiplier --- 
  const calculateAndUpdateMultiplier = (playerId: string) => {
    const playerPets = playerSessionPets.get(playerId) || [];
    // --- MODIFIED: Start with base multiplier and add bonuses --- 
    let stackedMultiplier = MULTIPLIER_DEFAULT; // Start with 1.0x

    // Keep track of unique pet types encountered to avoid stacking same bonus multiple times if player has duplicates
    const countedPetTypes = new Set<string>(); 

    // Iterate through the player's session pets
    for (const pet of playerPets) {
      // Check BASIC pets
      if (pet.rarity === EggType.BASIC) { 
        const petTypeLower = pet.type.toLowerCase();
        if (!countedPetTypes.has(petTypeLower)) {
          switch (petTypeLower) {
            case 'chicken':
              // Bonus = 0
              countedPetTypes.add(petTypeLower);
              break;
            case 'rabbit':
              stackedMultiplier += (MULTIPLIER_RABBIT - MULTIPLIER_DEFAULT); 
              countedPetTypes.add(petTypeLower);
              break;
            case 'pig':
              stackedMultiplier += (MULTIPLIER_PIG - MULTIPLIER_DEFAULT); 
              countedPetTypes.add(petTypeLower);
              break;
          }
        }
      }
      // --- ADDED: Check SILVER pets --- 
      else if (pet.rarity === EggType.SILVER) {
        const petTypeLower = pet.type.toLowerCase();
        if (!countedPetTypes.has(petTypeLower)) {
            switch (petTypeLower) {
                case 'cow':
                    stackedMultiplier += (MULTIPLIER_COW - MULTIPLIER_DEFAULT);
                    countedPetTypes.add(petTypeLower);
                    break;
                case 'bat':
                    stackedMultiplier += (MULTIPLIER_BAT - MULTIPLIER_DEFAULT);
                    countedPetTypes.add(petTypeLower);
                    break;
                case 'sheep':
                    stackedMultiplier += (MULTIPLIER_SHEEP - MULTIPLIER_DEFAULT);
                    countedPetTypes.add(petTypeLower);
                    break;
            }
        }
      }
      // --- ADDED: Check GOLDEN pets --- 
      else if (pet.rarity === EggType.GOLDEN) {
        const petTypeLower = pet.type.toLowerCase();
        if (!countedPetTypes.has(petTypeLower)) {
            switch (petTypeLower) {
                case 'donkey':
                    stackedMultiplier += (MULTIPLIER_DONKEY - MULTIPLIER_DEFAULT);
                    countedPetTypes.add(petTypeLower);
                    break;
                case 'squid':
                    stackedMultiplier += (MULTIPLIER_SQUID - MULTIPLIER_DEFAULT);
                    countedPetTypes.add(petTypeLower);
                    break;
                case 'ocelot':
                    stackedMultiplier += (MULTIPLIER_OCELOT - MULTIPLIER_DEFAULT);
                    countedPetTypes.add(petTypeLower);
                    break;
            }
        }
      }
      // --- ADDED: Check DIAMOND pets --- 
      else if (pet.rarity === EggType.DIAMOND) {
        const petTypeLower = pet.type.toLowerCase();
        if (!countedPetTypes.has(petTypeLower)) {
            switch (petTypeLower) {
                case 'spider':
                    stackedMultiplier += (MULTIPLIER_SPIDER - MULTIPLIER_DEFAULT);
                    countedPetTypes.add(petTypeLower);
                    break;
                case 'payload bomb': // Make sure the type matches how it was saved
                    stackedMultiplier += (MULTIPLIER_PAYLOAD_BOMB - MULTIPLIER_DEFAULT);
                    countedPetTypes.add(petTypeLower);
                    break;
                case 'dd': // Make sure the type matches how it was saved (Doge Dog)
                    stackedMultiplier += (MULTIPLIER_DD - MULTIPLIER_DEFAULT);
                    countedPetTypes.add(petTypeLower);
                    break;
            }
        }
      }
      // --- END ADDED --- 
       // TODO: Add checks for DIAMOND pets later
    }

    // Get the current multiplier to see if it changed
    const currentMultiplier = playerMultipliers.get(playerId) ?? MULTIPLIER_DEFAULT;

    if (stackedMultiplier !== currentMultiplier) {
      console.log(`[Multiplier] Updating multiplier for ${playerId} from ${currentMultiplier.toFixed(1)}x to ${stackedMultiplier.toFixed(1)}x`);
      playerMultipliers.set(playerId, stackedMultiplier);
      // Restart tower building with the new speed
      startOrUpdateTowerBuilding(playerId);
    } else {
      // console.log(`[Multiplier] Multiplier for ${playerId} remains ${stackedMultiplier.toFixed(1)}x`); // Optional: Log if no change
    }
  };
  // --- END ADDED --- 

  // --- ADDED: Function to handle moving player up while hovering ---
  const updateHoveringPlayerPosition = (playerId: string) => {
    const towerData = playerTowerData.get(playerId);
    const playerEntity = playerEntities.get(playerId);

    // Only proceed if player exists, has tower data, and is currently hovering
    if (playerEntity && towerData?.isHovering) {
        // Calculate the Y level of the topmost block (same logic as in teleport request)
        const topBlockY = towerData.layerIndex === 0 && towerData.currentY > towerData.location.center.y
                            ? towerData.currentY - 1
                            : towerData.currentY;

        // Calculate the target hover position
        const hoverY = topBlockY + 1.5; // Keep Y offset consistent
        const hoverDestination = new Vector3(towerData.location.center.x, hoverY, towerData.location.center.z);

        // Teleport player smoothly to the new hover position
        // Check if the player is already close to avoid unnecessary teleport calls
        const currentPos = playerEntity.position;
        const distanceSq = (currentPos.x - hoverDestination.x)**2 + (currentPos.y - hoverDestination.y)**2 + (currentPos.z - hoverDestination.z)**2;
        
        if (distanceSq > 0.01) { // Only teleport if not already very close
             console.log(`[Hover Update] Moving ${playerEntity.player.username} to ${hoverDestination.x.toFixed(2)}, ${hoverDestination.y.toFixed(2)}, ${hoverDestination.z.toFixed(2)}`);
             // <<< FIX: Use setPosition instead of teleport >>>
             playerEntity.setPosition(hoverDestination);
        }
    }
  };
  // --- END ADDED ---

}); // End startServer

// Placeholder for LeaderboardEntry if not defined elsewhere
interface LeaderboardEntry {
    playerId: string;
    name: string;
    score: number;
}

// Placeholder type for pet data from persistence
interface PlayerPetData {
    hasPet?: boolean;
    petType?: string;
    // Add other relevant fields if known
}

// --- Placeholder function definitions ---
const spawnPetForPlayer = (playerId: string, playerEntity: PlayerEntity, petType: string) => {
    console.log(`Placeholder: Spawning pet type '${petType}' for player ${playerId}`);
    // TODO: Implement actual pet spawning logic here
    // Example: Create pet entity, set model, spawn, add to petFollowStates
};

const tryClaimEgg = (playerId: string, eggId: string) => {
    console.log(`Placeholder: Player ${playerId} attempting to claim egg ${eggId}`);
    // TODO: Implement actual egg claiming logic here
    // Example: Check egg state, trigger hatching animation/sound, spawn pet, update persistence
};

// Egg Types Enum
enum EggType {
  BASIC = 'basic',
  SILVER = 'silver', // Add silver egg type
  GOLDEN = 'golden', // Add golden egg type
  DIAMOND = 'diamond', // Add diamond egg type
}

// Constants for Eggs
const EGG_MODEL_BASIC = 'models/eggs/basic_egg.gltf';
const EGG_MODEL_SILVER = 'models/eggs/silver_egg.gltf'; // Model for silver egg
const EGG_MODEL_GOLDEN = 'models/eggs/golden_egg.gltf'; // Model for golden egg
const EGG_MODEL_DIAMOND = 'models/eggs/diamond_egg.gltf'; // Model for diamond egg
const EGG_SCALE = 0.8;
const EGG_SPAWN_RADIUS = 15;
const EGG_SPAWN_HEIGHT = 10;
const EGG_COUNT = 10; // Total number of eggs to spawn
const EGG_ROTATE_SPEED = 0.5;
const EGG_OPEN_DURATION_MS = 3000; // 3 seconds to open
const EGG_INTERACT_DISTANCE = 3;
const EGG_SHAKE_AMPLITUDE = 0.05; // How much the egg shakes vertically

// Constants for Basic Pet (Rabbit)
const BASIC_PET_MODEL_URI = 'models/npcs/rabbit.gltf';
const BASIC_PET_SCALE = 0.6;
const BASIC_PET_IDLE_ANIMATION = 'idle';
const BASIC_PET_WALK_ANIMATION = 'walk'; // Example

// Constants for Silver Pet (Sheep)
const SILVER_PET_MODEL_URI = 'models/npcs/sheep.gltf'; // <<< SHEEP MODEL
const SILVER_PET_SCALE = 0.6; // Scale for sheep (adjusted to 0.6)
const SILVER_PET_IDLE_ANIMATION = 'idle'; // Idle animation for sheep
const SILVER_PET_WALK_ANIMATION = 'walk'; // Walk animation for sheep

// --- UPDATED: Constants for Golden Pet (Donkey - Ground) ---
const GOLDEN_PET_MODEL_URI = 'models/npcs/donkey.gltf';   // <<< Path to Donkey model
const GOLDEN_PET_SCALE = 0.6;                           // <<< Scale for Donkey
const GOLDEN_PET_IDLE_ANIMATION = 'idle';               // <<< Idle animation for Donkey
const GOLDEN_PET_WALK_ANIMATION = 'walk';               // <<< Walk animation for Donkey

// Constants for Pet Following Behavior
const PET_FOLLOW_DISTANCE = 2.5; // How close the pet stays to the player
const PET_HOVER_OFFSET_Y = 1.5; // How high flying pets hover above player's base

// --- UPDATED: Constants for Diamond Pet (Doge Dog - Spinning) ---
const DIAMOND_PET_MODEL_URI = 'models/npcs/dogedog2.glb'; // Path to Doge Dog model
const DIAMOND_PET_SCALE = 0.7;                           // Scale for Doge Dog
const DIAMOND_PET_IDLE_ANIMATION = ''; // No idle animation
const DIAMOND_PET_WALK_ANIMATION = ''; // No walk animation

// --- ADDED: Constants for Pig Pet --- 
const PIG_MODEL_URI = 'models/npcs/pig.gltf';
const PIG_MODEL_SCALE = 0.4; // Reduced size
const PIG_IDLE_ANIMATION = 'idle'; // Assuming standard 'idle'
const PIG_WALK_ANIMATION = 'walk'; // Assuming standard 'walk'

// --- ADDED: Constants for Chicken Pet --- 
const CHICKEN_MODEL_URI = 'models/npcs/chicken.gltf'; 
const CHICKEN_MODEL_SCALE = 0.3; // Made smaller than pig
const CHICKEN_IDLE_ANIMATION = 'idle'; // Assuming standard 'idle'
const CHICKEN_WALK_ANIMATION = 'walk'; // Assuming standard 'walk'

// --- ADDED: Constants for Silver Egg Pets ---
const COW_MODEL_URI = 'models/npcs/cow.gltf';
const COW_MODEL_SCALE = 0.6; 
const COW_IDLE_ANIMATION = 'idle';
const COW_WALK_ANIMATION = 'walk';

const BAT_MODEL_URI = 'models/npcs/bat.gltf';
const BAT_MODEL_SCALE = 0.3;
const BAT_IDLE_ANIMATION = 'idle'; // Assuming 'idle', might be 'fly' or similar
const BAT_WALK_ANIMATION = 'idle'; // MODIFIED: Use 'idle' (wing flap) for movement too

const SHEEP_MODEL_URI = 'models/npcs/sheep.gltf';
const SHEEP_MODEL_SCALE = 0.5;
const SHEEP_IDLE_ANIMATION = 'idle';
const SHEEP_WALK_ANIMATION = 'walk';
// --- END ADDED ---

// --- ADDED: Constants for Golden Egg Pets ---
const DONKEY_MODEL_URI = 'models/npcs/donkey.gltf';
const DONKEY_MODEL_SCALE = 0.7;
const DONKEY_IDLE_ANIMATION = 'idle';
const DONKEY_WALK_ANIMATION = 'walk';

const SQUID_MODEL_URI = 'models/npcs/squid.gltf';
const SQUID_MODEL_SCALE = 0.5;
const SQUID_IDLE_ANIMATION = 'idle'; // Placeholder - might need adjustment
const SQUID_WALK_ANIMATION = 'walk'; // Placeholder for flying animation

const OCELOT_MODEL_URI = 'models/npcs/ocelot.gltf';
const OCELOT_MODEL_SCALE = 0.4;
const OCELOT_IDLE_ANIMATION = 'idle';
const OCELOT_WALK_ANIMATION = 'walk';
// --- END ADDED ---

// --- ADDED: Constants for Diamond Egg Pets (Spider) ---
const SPIDER_MODEL_URI = 'models/npcs/spider.gltf';
const SPIDER_MODEL_SCALE = 0.5; // Example scale
const SPIDER_IDLE_ANIMATION = 'idle';
const SPIDER_WALK_ANIMATION = 'walk';
// --- END ADDED ---

// --- ADDED: Constants for Payload Bomb ---
const PAYLOAD_BOMB_MODEL_URI = 'models/npcs/payload-bomb.gltf';
const PAYLOAD_BOMB_SCALE = 0.4;
const PAYLOAD_BOMB_WALK_ANIMATION = 'walk'; // Only has walk animation
// --- END ADDED ---

// --- Constants for Egg Interactions ---
// ... existing code ...

// --- ADDED: Handler for owned pets request ---
const handleOwnedPetsRequest = ({ player }: { player: Player }) => {
  console.log('[DEBUG] Handling owned pets request');
  
  const playerPets = playerSessionPets.get(player.id) || [];
  console.log(`[DEBUG] Found ${playerPets.length} session pets for player`);
  
  player.ui.sendData({
    type: 'updateOwnedPets',
    pets: playerPets
  });
};

// --- ADDED: Handler for delete pet request ---
const handleDeletePet = ({ player, data }: { player: Player, data: any }) => {
  console.log('[DEBUG] Handling delete pet request:', data);
  
  const playerPets = playerSessionPets.get(player.id);
  if (!playerPets) {
    console.log('[DEBUG] No pets found for player');
    player.ui.sendData({ type: 'petDeleteFailed', persistentId: data.persistentId, reason: 'No pets found' });
    return;
  }
  
  const petIndex = playerPets.findIndex(pet => pet.persistentId === data.persistentId);
  if (petIndex === -1) {
    console.log('[DEBUG] Pet not found in session storage');
    player.ui.sendData({ type: 'petDeleteFailed', persistentId: data.persistentId, reason: 'Pet not found' });
    return;
  }
  
  // Remove pet from session storage
  playerPets.splice(petIndex, 1);
  console.log(`[DEBUG] Removed pet from session storage. Player now has ${playerPets.length} pets`);
  
  // Send confirmation to UI
  player.ui.sendData({ type: 'petDeleteConfirmed', persistentId: data.persistentId });
  
  // Also send updated pets list
  player.ui.sendData({
    type: 'updateOwnedPets',
    pets: playerPets
  });
};

// --- Add a utility function for generating IDs ---
const generateId = (): string => {
  return Date.now() + '-' + Math.random().toString(36).substring(2, 7);
};

// Egg Costs
const COST_EGG_BASIC = 150;
const COST_EGG_SILVER = 350;
const COST_EGG_GOLDEN = 500;
const COST_EGG_DIAMOND = 1000;