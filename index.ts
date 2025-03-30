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

  // Create a map to track which pets are following which players
  const petFollowStates: Map<Entity, PetFollowState> = new Map();

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
      }
    }
    
    // Sort by score in descending order
    entries.sort((a, b) => b.score - a.score);
    
    // Update the leaderboard data
    leaderboardData = entries;
    
    // Send updated leaderboard to all connected players
    for (const playerEntity of playerEntities.values()) {
      playerEntity.player.ui.sendData({
        type: 'updateLeaderboard',
        leaderboard: leaderboardData
      });
    }
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
  const playerBlockResources: Map<string, number> = new Map(); 

  // MODIFIED: Tracks tower state including location and progress per player
  interface PlayerTowerState {
    location: TowerLocation;
    currentY: number;
    layerIndex: number;
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
    
    // Calculate direction vector ONLY in the XZ plane
    const dirX = playerPos.x - petPos.x;
    // const dirY = playerPos.y - petPos.y; // IGNORE Y for rotation
    const dirZ = playerPos.z - petPos.z;
    
    // Calculate distance in the XZ plane
    const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);
    
    // Only follow and rotate if not too close to avoid jittering
    if (distance > 1.5) {
      // Calculate the angle from pet to player ONLY in the XZ plane
      // Add Math.PI to rotate by 180 degrees, aligning the model's -Z axis forward
      const angle = Math.atan2(dirX, dirZ) + Math.PI;
      
      // Convert the angle to a quaternion for Y-axis rotation (yaw)
      const halfAngle = angle / 2;
      const qy = Math.sin(halfAngle);
      const qw = Math.cos(halfAngle);
      
      // Apply rotation to make the pet face the player horizontally
      // Keep X and Z rotation 0 to prevent pitching/rolling
      pet.setRotation({ x: 0, y: qy, z: 0, w: qw });

      // Normalize XZ direction vector for movement
      const normalizedDirX = dirX / distance;
      const normalizedDirZ = dirZ / distance;
      
      // Move pet towards player with a speed based on XZ distance
      const speed = Math.min(distance * 0.1, 0.5);

      // --- Vertical Movement (Keep Y Velocity 0 for ground pets) ---
      const velocityY = 0; // Default: no vertical velocity
      // REMOVED: Bat-specific hover logic
      // if (pet.modelUri === SILVER_PET_MODEL_URI) { ... }
      // --- End Vertical Movement ---

      // Apply velocity primarily in XZ, Y should be 0 unless gravity acts
      pet.setLinearVelocity({
        x: normalizedDirX * speed * 10,
        y: velocityY,
        z: normalizedDirZ * speed * 10,
      });

      // Play movement animation (walk/hop/fly etc.)
      pet.stopModelAnimations([idleAnimation]); 
      pet.startModelLoopedAnimations([walkAnimation]); // <<< USE walkAnimation

    } else {
      // Stop horizontal moving when close enough, Y velocity should also be 0
      // REMOVED: Bat-specific hover logic from else block
      pet.setLinearVelocity({ x: 0, y: 0, z: 0 });
      pet.setAngularVelocity({ x: 0, y: 0, z: 0 }); // Ensure angular velocity is zero

      // Play idle animation when not moving (close to player)
      // Stop walk/fly animation IF it was playing
      pet.stopModelAnimations([walkAnimation]);
      pet.startModelLoopedAnimations([idleAnimation]); // Ensure idle animation plays
    }
  };

  // --- Tower Simulator: Function to place the next block --- 
  const tryBuildTowerBlock = (playerId: string) => {
    const resources = playerBlockResources.get(playerId);
    const towerData = playerTowerData.get(playerId);

    // Check if player has tower data and resources
    if (!towerData || resources === undefined || resources < 1) {
       // Add warning log if build cannot proceed
       // console.warn(`[TowerBuild][WARN] Player ${playerId} cannot build. Has towerData: ${!!towerData}, Resources: ${resources}`); // DEBUG
      return; // Cannot build
    }

    // Use towerData.location for calculations
    const towerWidth = towerData.location.width;
    const towerDepth = towerData.location.depth;
    const blocksPerLayer = towerWidth * towerDepth;

    // Calculate the position of the next block in the current layer
    const layerX = towerData.layerIndex % towerWidth;
    const layerZ = Math.floor(towerData.layerIndex / towerWidth);

    // Use the center from the player's assigned tower location
    const blockX = towerData.location.center.x - (towerWidth / 2 - 0.5) + layerX;
    const blockY = towerData.currentY;
    const blockZ = towerData.location.center.z - (towerDepth / 2 - 0.5) + layerZ;

    // Determine the block type based on position (Stone corners, Wood inside)
    const isCorner = (layerX === 0 || layerX === towerWidth - 1) && (layerZ === 0 || layerZ === towerDepth - 1);
    const blockTypeId = isCorner ? STONE_BLOCK_ID : WOOD_BLOCK_ID; // <-- Restore original logic
    // const blockTypeId = STONE_BLOCK_ID; // <-- TEMPORARY TEST: Use only stone 

    // Explicitly floor X and Z coordinates to ensure integer values for setBlock
    const flooredX = Math.floor(blockX);
    const flooredZ = Math.floor(blockZ);

    // --- DEBUG LOGGING --- 
    // console.log(`[TowerBuild] Player: ${playerId}, Center: (${towerData.location.center.x.toFixed(1)}, ${towerData.location.center.z.toFixed(1)}), LayerIndex: ${towerData.layerIndex}, BlockPos: (${flooredX}, ${blockY.toFixed(1)}, ${flooredZ}), Type: ${blockTypeId}`); // DEBUG

    // --- Place the actual block instantly ---
    const targetBlockPos = new Vector3(flooredX, blockY, flooredZ); // Use floored coordinates
    world.chunkLattice.setBlock(targetBlockPos, blockTypeId);

    // --- Visual Effect: Spawn flying orb --- 
    const playerEntity = playerEntities.get(playerId);
    if (playerEntity) {
      // Correctly create copies of Vector3 instances
      const startPos = new Vector3(playerEntity.position.x, playerEntity.position.y + 0.5, playerEntity.position.z); // Start slightly above player center
      const endPos = new Vector3(targetBlockPos.x + 0.5, targetBlockPos.y + 0.5, targetBlockPos.z + 0.5); // Target center of block
      const travelDuration = 0.3; // seconds
      
      // Calculate direction and distance
      const direction = new Vector3(endPos.x - startPos.x, endPos.y - startPos.y, endPos.z - startPos.z);
      const distance = direction.length;
      direction.normalize(); // Make it a unit vector
      
      // Calculate required velocity
      const speed = distance / travelDuration;
      // Correctly create a copy for velocity calculation
      const velocity = new Vector3(direction.x * speed, direction.y * speed, direction.z * speed);

      // Create and spawn the visual orb entity
      const orbVisual = new Entity({
        modelUri: 'models/projectiles/energy-orb-projectile.gltf',
        modelScale: 0.3, // Scale it down a bit
        rigidBodyOptions: {
          type: RigidBodyType.KINEMATIC_VELOCITY, // Moves based on velocity, ignores physics
          linearVelocity: velocity, // Set the calculated velocity
          // Add a simple sensor collider to prevent physical interactions
          colliders: [{
            shape: ColliderShape.BALL, // Simple shape for the orb visual
            radius: 0.2, // Small radius for the visual effect
            isSensor: true // *** Make it a sensor ***
          }]
        }
      });
      orbVisual.spawn(world, startPos);

      // Despawn the orb after the travel duration
      setTimeout(() => {
        orbVisual.despawn();
      }, travelDuration * 1000); // Convert seconds to milliseconds
    }
    // --- End Visual Effect ---

    // Decrement resources
    playerBlockResources.set(playerId, resources - 1);

    // Update progress
    towerData.layerIndex++;
    if (towerData.layerIndex >= blocksPerLayer) {
      towerData.layerIndex = 0;
      towerData.currentY++; // Move up to the next level

      // Update Floor Display UI
      const floorDisplayUI = playerFloorDisplayUIs.get(playerId);
      if (floorDisplayUI) {
        // Assuming base Y is layer 0, floor = currentY - baseY + 1
        // Use the specific tower's base Y for accurate floor calculation
        const currentFloor = towerData.currentY - towerData.location.center.y + 1;
        floorDisplayUI.setState({ floor: currentFloor });
      }
      // Add info log for layer completion
      // console.log(`[TowerBuild][INFO] Player ${playerId} completed layer. Reset layerIndex to 0. New Y: ${towerData.currentY}`); // DEBUG
    }

    // Save the updated progress
    playerTowerData.set(playerId, towerData); // Save the modified towerData back to the map
  };

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
    playersInRange: Set<string>; // ADDED: Track players near this egg
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
  const EGG_RESPAWN_DELAY_MS = 10000; // 10 seconds

  /**
   * Handle the tick event for an individual egg entity.
   * This function manages the opening animation and despawning.
   * It also handles showing/hiding the proximity prompt for nearby players.
   */
  const handleEggTick = (payload: { entity: Entity; tickDeltaMs: number; }) => {
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

    // --- ADDED: Proximity Check for Egg Prompt --- 
    const eggPosition = entity.position; 
    const currentTickInRange = new Set<string>();
    // Use the existing playerEntities map to get PlayerEntity instances
    const allPlayerEntities = playerEntities.values();

    for (const playerEntity of allPlayerEntities) {
      // Ensure playerEntity and its position are valid before calculating distance
      if (!playerEntity || !playerEntity.position) {
          console.warn(`Skipping proximity check for invalid player entity.`);
          continue; // Skip this player if invalid
      }
      const playerPosition = playerEntity.position;
      const distance = calculateDistance(eggPosition, playerPosition);

      if (distance <= EGG_PROMPT_DISTANCE) {
        const playerId = playerEntity.player.id;
        currentTickInRange.add(playerId);
        // If player just entered range, show the correct prompt based on egg type
        if (!eggState.playersInRange.has(playerId)) {
          // --- Check egg type and send appropriate message ---
          if (eggState.modelUri === ORIGINAL_EGG_MODEL_URI) {
            console.log(`[UI PROMPT] Player ${playerId} ENTERED range of ORIGINAL egg ${entity.id}. Sending visible=true.`); // DETAILED LOG
            playerEntity.player.ui.sendData({ type: 'updateChickenEggPrompt', visible: true }); 
          } else if (eggState.modelUri === SILVER_EGG_MODEL_URI) {
            console.log(`[UI PROMPT] Player ${playerId} ENTERED range of SILVER egg ${entity.id}. Sending visible=true.`); // DETAILED LOG
            playerEntity.player.ui.sendData({ type: 'updateSilverEggPrompt', visible: true }); 
          } else if (eggState.modelUri === GOLDEN_EGG_MODEL_URI) {
            console.log(`[UI PROMPT] Player ${playerId} ENTERED range of GOLDEN egg ${entity.id}. Sending visible=true.`); // DETAILED LOG
            playerEntity.player.ui.sendData({ type: 'updateGoldenEggPrompt', visible: true }); 
          } else if (eggState.modelUri === DIAMOND_EGG_MODEL_URI) {
            console.log(`[UI PROMPT] Player ${playerId} ENTERED range of DIAMOND egg ${entity.id}. Sending visible=true.`); // DETAILED LOG
            playerEntity.player.ui.sendData({ type: 'updateDiamondEggPrompt', visible: true }); 
          }
        }
      }
    }

    // Check for players who moved out of range
    for (const playerId of eggState.playersInRange) {
      if (!currentTickInRange.has(playerId)) {
        // Get the PlayerEntity from the map
        const playerEntity = playerEntities.get(playerId); 
        if (playerEntity) {
          // --- Check egg type and send appropriate message to hide prompt ---
          if (eggState.modelUri === ORIGINAL_EGG_MODEL_URI) {
            console.log(`[UI PROMPT] Player ${playerId} LEFT range of ORIGINAL egg ${entity.id}. Sending visible=false.`); // DETAILED LOG
            playerEntity.player.ui.sendData({ type: 'updateChickenEggPrompt', visible: false }); 
          } else if (eggState.modelUri === SILVER_EGG_MODEL_URI) {
            console.log(`[UI PROMPT] Player ${playerId} LEFT range of SILVER egg ${entity.id}. Sending visible=false.`); // DETAILED LOG
            playerEntity.player.ui.sendData({ type: 'updateSilverEggPrompt', visible: false }); 
          } else if (eggState.modelUri === GOLDEN_EGG_MODEL_URI) {
            console.log(`[UI PROMPT] Player ${playerId} LEFT range of GOLDEN egg ${entity.id}. Sending visible=false.`); // DETAILED LOG
            playerEntity.player.ui.sendData({ type: 'updateGoldenEggPrompt', visible: false }); 
          } else if (eggState.modelUri === DIAMOND_EGG_MODEL_URI) {
            console.log(`[UI PROMPT] Player ${playerId} LEFT range of DIAMOND egg ${entity.id}. Sending visible=false.`); // DETAILED LOG
            playerEntity.player.ui.sendData({ type: 'updateDiamondEggPrompt', visible: false }); 
          }
        }
      }
    }

    // Update the set of players currently in range for the next tick
    eggState.playersInRange = currentTickInRange;
    // --- END ADDED: Proximity Check --- 
    // } // <-- REMOVED THIS LINE
    // --- End ORIGINAL egg specific check --- // <-- Updated comment

    // --- General Egg Logic (Floating, Opening) applies to ALL eggs --- 
    const deltaTimeS = tickDeltaMs / 1000.0;
    eggState.animationTime += deltaTimeS;

    let currentRotateSpeed = EGG_ROTATE_SPEED;
    // Initialize position based on floating calculation using the egg's specific base position
    let currentPositionVec = new Vector3(
      eggState.basePosition.x,
      eggState.basePosition.y + Math.sin(eggState.animationTime * EGG_FLOAT_SPEED) * EGG_FLOAT_AMPLITUDE,
      eggState.basePosition.z
    );

    // --- Handle Opening Sequence ---
    if (eggState.isOpening && eggState.openStartTime) {
      const elapsedTime = Date.now() - eggState.openStartTime;

      // --- Check if hatching time is reached ---
      if (elapsedTime >= EGG_OPEN_DURATION_MS) {
        console.log(`Egg (${entity.id}, Type: ${eggState.eggType}) hatching!`); // Log type
        const hatchPosition = entity.position; // Get position before despawning
        const openingPlayerEntity = playerEntities.get(eggState.openingPlayerId || ''); // Get player who opened

        // Despawn egg and remove its state
        entity.despawn();
        if (typeof entity.id === 'number') {
          activeEggs.delete(entity.id);
        } else {
          console.warn("Could not delete egg state: Invalid entity ID after despawn.");
        }

        // --- Determine which animal hatches based on eggType ---
        let petModelUri: string;
        let petScale: number;
        let petIdleAnimation: string;
        let petWalkAnimation: string;
        let petTypeName: string; // For logging/messages

        switch (eggState.eggType) {
          case EggType.SILVER:
            petModelUri = SILVER_PET_MODEL_URI;
            petScale = SILVER_PET_SCALE;
            petIdleAnimation = SILVER_PET_IDLE_ANIMATION;
            petWalkAnimation = SILVER_PET_WALK_ANIMATION;
            petTypeName = 'Sheep';
            console.log(`Silver Egg hatched a Sheep!`);
            break;
          case EggType.BASIC:
          default:
            petModelUri = BASIC_PET_MODEL_URI;
            petScale = BASIC_PET_SCALE;
            petIdleAnimation = BASIC_PET_IDLE_ANIMATION;
            petWalkAnimation = BASIC_PET_WALK_ANIMATION;
            petTypeName = 'Rabbit';
            console.log(`Basic Egg hatched a Rabbit!`);
            break;
        }

        // --- Calculate Spawn Position (Should be same as hatchPosition for Cow) ---
        const spawnPosition = hatchPosition; // Use hatch position directly
        const verticalNudge = 0; // No vertical nudge for ground pets
        // REMOVED: Bat-specific height adjustment
        // if (petTypeName === 'Cow') { ... }

        // --- Spawn the chosen animal ---
        const newPet = new Entity({
          modelUri: petModelUri,
          modelScale: petScale,
          rigidBodyOptions: {
            type: RigidBodyType.DYNAMIC,
            enabledRotations: { x: false, y: true, z: false },
          },
        });

        // Initialize follow state for the new pet
        const petFollowState: PetFollowState = {
          isFollowing: false,
          targetPlayerId: null,
          targetEntity: null,
        };
        petFollowStates.set(newPet, petFollowState);

        // Spawn pet at the hatch position
        newPet.spawn(world, spawnPosition);
        console.log(`${petTypeName} spawned at:`, spawnPosition);

        // Apply nudge (horizontal only for Cow)
        const nudgeImpulse = { x: (Math.random() - 0.5) * 4 * newPet.mass, y: verticalNudge, z: (Math.random() - 0.5) * 4 * newPet.mass };
        newPet.applyImpulse(nudgeImpulse);
        console.log(`Applied nudge impulse to ${petTypeName}:`, nudgeImpulse);

        // Create and Load Animal Nametag Scene UI
        const animalNametagUI = new SceneUI({
          templateId: 'rabbit-nametag', // TODO: Needs update for different pets
          attachedToEntity: newPet,
          offset: { x: 0, y: petScale * 1.5, z: 0 }, // Adjust offset based on scale
          state: {
            ownerName: openingPlayerEntity?.player.username || 'Unknown',
            // Set status based on egg type
            status: eggState.eggType === EggType.BASIC ? 'Basic' : 'Normal', // Changed 'normal' to 'Normal' for non-basic
            // Add a class for styling based on status
            statusClass: eggState.eggType === EggType.BASIC ? 'status-basic' : 'status-normal'
          },
        });
        animalNametagUI.load(world);

        // Attach TICK listener FOR THIS SPECIFIC PET
        newPet.on(EntityEvent.TICK, () => {
          const followState = petFollowStates.get(newPet);
          if (followState?.isFollowing && followState.targetEntity && followState.targetPlayerId && playerEntities.has(followState.targetPlayerId)) {
            // Use generic animation names stored for the pet type
            updatePetMovement(newPet, followState.targetEntity, petWalkAnimation, petIdleAnimation);
          } else if (followState?.isFollowing) {
            // Target became invalid, stop following
            console.log(`${petTypeName} (${newPet.id}) stopped following invalid target: ${followState.targetPlayerId}`);
            followState.isFollowing = false;
            followState.targetPlayerId = null;
            followState.targetEntity = null;
            // Manually stop animations as fallback
            newPet.stopModelAnimations([petWalkAnimation]);
            newPet.startModelLoopedAnimations([petIdleAnimation]);
            newPet.setLinearVelocity({ x: 0, y: 0, z: 0 });
            newPet.setAngularVelocity({ x: 0, y: 0, z: 0 });
          } else {
            // If not following, ensure velocity is zero and idle animation is playing
            newPet.setLinearVelocity({ x: 0, y: 0, z: 0 });
            newPet.setAngularVelocity({ x: 0, y: 0, z: 0 });
             // Ensure idle animation plays if not explicitly stopped/started elsewhere
            if (!newPet.modelLoopedAnimations.has(petIdleAnimation)) {
                newPet.stopModelAnimations([petWalkAnimation]); // Stop the specific walk animation
                newPet.startModelLoopedAnimations([petIdleAnimation]);
            }
          }
        });

        // --- Make the pet follow the player who opened the egg ---
        if (openingPlayerEntity) {
          console.log(`Making ${petTypeName} (${newPet.id}) follow ${openingPlayerEntity.player.username}`);
          makePetFollow(newPet, openingPlayerEntity, petTypeName, petWalkAnimation, petIdleAnimation);

          // Save pet state to player persistence
          openingPlayerEntity.player.setPersistedData('playerPet', {
            hasPet: true,
            petType: eggState.eggType, // Store the EggType enum value
          }).catch(error => {
            console.error(`Error saving pet data for player ${openingPlayerEntity.player.username}:`, error);
          });
        } else {
          console.warn(`Could not make pet follow: openingPlayerEntity not found for ID ${eggState.openingPlayerId}`);
        }

        // --- Respawn THIS egg after a delay ---
        console.log(`Scheduling egg respawn for model ${eggState.modelUri} in ${EGG_RESPAWN_DELAY_MS / 1000} seconds.`);
        setTimeout(() => createAndSpawnEgg(eggState.modelUri, eggState.basePosition, eggState.eggType), EGG_RESPAWN_DELAY_MS);

        return; // Stop processing this tick for the despawned egg
      }
      // --- Continue Opening Animation/Shake ---
      currentRotateSpeed *= 4; // Spin faster
      const shakeX = (Math.random() - 0.5) * EGG_SHAKE_AMPLITUDE * 2;
      const shakeZ = (Math.random() - 0.5) * EGG_SHAKE_AMPLITUDE * 2;
      currentPositionVec.x += shakeX;
      currentPositionVec.z += shakeZ;
      currentPositionVec.y = eggState.basePosition.y + (Math.random() - 0.5) * EGG_SHAKE_AMPLITUDE;

      // Set angular velocity for faster spinning during opening
      entity.setAngularVelocity({ x: 0, y: EGG_ROTATE_SPEED * 4, z: 0 });

    } else {
      // If not opening, reset angular velocity to normal spin
      entity.setAngularVelocity({ x: 0, y: EGG_ROTATE_SPEED, z: 0 });
    }
    // --- End Opening Sequence Handling ---

    // Set position using the calculated/modified Vector3 instance
    entity.setPosition(currentPositionVec);

    // --- REMOVED MANUAL ROTATION LOGIC ---
    // The KINEMATIC_VELOCITY rigid body type now handles rotation based on angularVelocity.
    // const angle = eggState.animationTime * currentRotateSpeed;
    // const halfAngle = angle * 0.5;
    // const qy = Math.sin(halfAngle);
    // const qw = Math.cos(halfAngle);
    
    // console.log(`Egg ${entity.id}: animTime=${eggState.animationTime.toFixed(2)}, speed=${currentRotateSpeed}, angle=${angle.toFixed(2)}, qy=${qy.toFixed(2)}, qw=${qw.toFixed(2)}`);
    
    // entity.setRotation({ x: 0, y: qy, z: 0, w: qw });
    // --- END REMOVED MANUAL ROTATION LOGIC ---
  };
  // --- End Refactored Egg TICK Handler ---

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
        pet.stopModelAnimations([petWalkAnimation]);
        pet.startModelLoopedAnimations([petIdleAnimation]);
        
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
        pet.stopModelAnimations([petIdleAnimation]);
        pet.startModelLoopedAnimations([petWalkAnimation]);
        
        world.chatManager.sendPlayerMessage(
          playerEntity.player, 
          `${petTypeName} started following you!`, // Use the petTypeName argument directly
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
    // Basic check to prevent excessive eggs if respawn logic goes wild
    // A more robust check might look at proximity or count eggs of a specific type.
    if (activeEggs.size >= 10) {
        console.warn("Maximum number of eggs reached. Not spawning new egg.");
        return;
    }

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
      playersInRange: new Set<string>(), // ADDED: Initialize empty set
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
      createAndSpawnEgg(chosenEggModel, new Vector3(x, y, z), chosenEggType);
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

    console.log(`Player ${player.username} (${player.id}) joined.`);

    // --- Initialize Score & Leaderboard ---
    if (!playerScores.has(player.id)) {
        playerScores.set(player.id, 0);
        updateLeaderboard();
    }

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

        // Start Automatic Tower Building Interval for this player
        const towerBuildInterval = setInterval(() => {
          tryBuildTowerBlock(player.id);
        }, 200);
        playerBlockIntervals.set(`tower_${player.id}`, towerBuildInterval);
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
          console.log(`Received teleport request from ${playerUI.player.username}`);
          const towerData = playerTowerData.get(currentPlayerId); // Get player's tower data

          if (towerData) { // Check if player has tower data (they might not if all slots were full)
            const teleportY = towerData.currentY + 2;
            const teleportDestination = new Vector3(towerData.location.center.x, teleportY, towerData.location.center.z);

            console.log(`Teleporting ${playerUI.player.username} to ${teleportDestination.x}, ${teleportDestination.y}, ${teleportDestination.z}`);
            if (currentPlayerEntity.rawRigidBody) {
              currentPlayerEntity.rawRigidBody.teleport(teleportDestination, true);
            } else {
              console.error(`Could not teleport ${playerUI.player.username}: rawRigidBody not found.`);
            }
          } else {
            console.warn(`Player ${playerUI.player.username} requested teleport but has no assigned tower.`);
            // Maybe send a chat message back?
            // playerUI.player.chat("You don't have a tower to teleport to!");
          }
      }
      // Handle Pet Interaction Requests
      else if (data && data.type === 'requestPetInteraction') {
          console.log(`Received pet interaction request from ${playerUI.player.username}`);
          // Find the closest pet to the player
          let closestPet: Entity | null = null;
          let minDistance = Infinity;

          for (const pet of petFollowStates.keys()) {
            if (pet.modelUri === RABBIT_MODEL_URI || pet.modelUri === PIG_MODEL_URI || pet.modelUri === CHICKEN_MODEL_URI) { // Ensure it's a rabbit, pig, or chicken pet
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

    // --- ADDED: Listen for Player Input Tick (F Key Interaction) ---
    // PlayerEntity by default has a PlayerEntityController assigned to .controller,
    // but we explicitly assert that with ! to prevent typescript from complaining.
    playerEntity.controller!.on(BaseEntityControllerEvent.TICK_WITH_PLAYER_INPUT, ({ entity, input, cameraOrientation, deltaTimeMs }) => {
      // Check if F key (or other interaction key) is pressed AND if the pressed state wasn't already handled this press
      if (input.f && !playerEPressedState.get(player.id)) { // Assuming 'f' is the interaction key in PlayerInput
        playerEPressedState.set(player.id, true); // Mark as handled for this press down

        console.log(`Player ${player.username} pressed F`); // Debug log

        // Find the nearest non-opening egg within interaction range
        let closestEgg: EggState | null = null;
        let minDistance = EGG_INTERACT_DISTANCE; // Use the defined interaction distance

        for (const eggState of activeEggs.values()) {
          // Check if the egg is NOT already opening
          if (!eggState.isOpening) {
            const distance = calculateDistance(entity.position, eggState.entity.position);
            if (distance <= minDistance) {
              minDistance = distance;
              closestEgg = eggState;
            }
          }
        }

        // If a valid egg is found, check its type before opening
        if (closestEgg) {
          // --- ADDED Check: Only allow opening BASIC or SILVER eggs with 'F' --- 
          if (closestEgg.eggType === EggType.BASIC || closestEgg.eggType === EggType.SILVER) {
            console.log(`Player ${player.username} starting to open ${closestEgg.eggType} egg ${closestEgg.entity.id}`); // Debug log
            closestEgg.isOpening = true;
            closestEgg.openStartTime = Date.now();
            closestEgg.openingPlayerId = player.id; // Store who opened it

            // Play an opening sound effect at the egg's location
            const openSound = new Audio({
              uri: 'audio/sfx/egg_open_start.mp3', // Replace with your actual sound effect
              position: closestEgg.entity.position,
              volume: 0.7,
            });
            openSound.play(world);

            // Optionally, update the SceneUI or OverlayUI to show opening progress
            // player.ui.sendData({ type: 'eggOpeningStarted', eggId: closestEgg.entity.id });
          } else {
            // Log if the player tried to open an egg of an unsupported type with 'F'
            console.log(`Player ${player.username} tried to open egg ${closestEgg.entity.id} of type ${closestEgg.eggType}, which is not supported by F key.`);
          }
        } else {
          console.log(`Player ${player.username} pressed F, but no interactable egg was nearby.`); // Debug log
        }

      } else if (!input.f) {
        // Reset the pressed state when the key is released
        playerEPressedState.set(player.id, false);
      }
    });
    // --- END ADDED: Listen for Player Input Tick ---

    // --- Player Initial State (Spawn Pet etc.) ---
    // Load player-specific data using the Player object
    PersistenceManager.instance.getPlayerData(player) // Corrected: Pass the player object
        .then((playerData: Record<string, unknown> | void) => { // Expect generic object or void
            // Check if playerData exists and is an object
            if (playerData && typeof playerData === 'object') {
                // Check if the 'petInfo' key exists within the player data
                if ('petInfo' in playerData && playerData.petInfo) {
                    // Assume petInfo has the structure PlayerPetData
                    const petData = playerData.petInfo as PlayerPetData; // Type assertion

                    if (petData.hasPet && petData.petType === 'rabbit') {
                        console.log(`Player ${player.username} has saved rabbit pet data. Spawning pet.`);
                        spawnPetForPlayer(player.id, playerEntity, 'rabbit'); // Call the placeholder
                    } else {
                        console.log(`Player ${player.username} has petInfo, but no rabbit pet indicated.`);
                    }
                } else {
                     console.log(`Player ${player.username} has saved data, but no 'petInfo' field found.`);
                }
            } else {
                console.log(`Player ${player.username} has no saved player data found.`);
            }
        }).catch((error: any) => { // Added type annotation for error
            console.error(`Error loading player data for player ${player.id}:`, error);
        });

  }); // End JOINED_WORLD listener

  world.on(PlayerEvent.LEFT_WORLD, ({ player }: { player: Player }) => {
    console.log(`Player ${player.username} (${player.id}) left the world.`);
    
    // --- Cleanup player entity ---
    const playerEntity = playerEntities.get(player.id);
    if (playerEntity) {
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
        // Reset pet to idle animation
        if (pet.modelUri === RABBIT_MODEL_URI || pet.modelUri === PIG_MODEL_URI || pet.modelUri === CHICKEN_MODEL_URI) {
          pet.stopModelAnimations(['hop']);
          pet.startModelLoopedAnimations(['idle']);
        }
      }
    }
    
    // Cleanup interaction state
    playerEPressedState.delete(player.id); // Clean up E key state
    playerEPressedState.delete(`prompt_${player.id}`); // Clean up prompt visibility state tracking

    // Update leaderboard after player leaves
    playerScores.delete(player.id);
    updateLeaderboard();
  });

  // ... Rest of the code (tick handlers, update functions, etc.) ...

}); // End startServer callback

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
const BASIC_PET_WALK_ANIMATION = 'hop';

// Constants for Silver Pet (Sheep)
const SILVER_PET_MODEL_URI = 'models/npcs/sheep.gltf'; // <<< SHEEP MODEL
const SILVER_PET_SCALE = 0.6; // Scale for sheep (adjusted to 0.6)
const SILVER_PET_IDLE_ANIMATION = 'idle'; // Idle animation for sheep
const SILVER_PET_WALK_ANIMATION = 'walk'; // Walk animation for sheep

// Constants for Pet Following Behavior
const PET_FOLLOW_DISTANCE = 2.5; // How close the pet stays to the player
const PET_HOVER_OFFSET_Y = 1.5; // How high flying pets hover above player's base