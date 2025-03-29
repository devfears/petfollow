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
} from 'hytopia';

import worldMap from './assets/map.json';

// Define a custom type to track which animals follow the player
interface PetFollowState {
  isFollowing: boolean;
  targetPlayerId: string | null;
  targetEntity: PlayerEntity | null;
}

/**
 * startServer is always the entry point for our game.
 * It accepts a single function where we should do any
 * setup necessary for our game. The init function is
 * passed a World instance which is the default
 * world created by the game server on startup.
 * 
 * Documentation: https://github.com/hytopiagg/sdk/blob/main/docs/server.startserver.md
 */

startServer(world => {
  // Disable debug rendering to improve performance
  // world.simulation.enableDebugRendering(true);
  
  /**
   * Load our map.
   * You can build your own map using https://build.hytopia.com
   * After building, hit export and drop the .json file in
   * the assets folder as map.json.
   */
  world.loadMap(worldMap);

  // Store all player entities for reference
  const playerEntities: Map<string, PlayerEntity> = new Map();

  // Create a map to track which pets are following which players
  const petFollowStates: Map<Entity, PetFollowState> = new Map();
  
  // Initialize global interaction counters
  let totalInteractions = 0;
  
  // Load global statistics from persistence
  PersistenceManager.instance.getGlobalData('petStats').then(stats => {
    if (stats) {
      totalInteractions = stats.totalInteractions || 0;
      console.log(`Loaded total pet interactions: ${totalInteractions}`);
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
    
    // Update stats for all connected players
    for (const playerEntity of playerEntities.values()) {
      playerEntity.player.ui.postMessage({
        type: 'updateStats',
        totalInteractions
      });
    }
  };

  /**
   * Calculate distance between two Vector3 positions
   */
  const calculateDistance = (pos1: Vector3, pos2: Vector3): number => {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  /**
   * Update pet movement towards target player
   */
  const updatePetMovement = (pet: Entity, playerEntity: PlayerEntity) => {
    const petPos = pet.position;
    const playerPos = playerEntity.position;
    
    // Calculate direction vector to player
    const dirX = playerPos.x - petPos.x;
    const dirZ = playerPos.z - petPos.z;
    
    // Calculate distance to player
    const distance = Math.sqrt(dirX * dirX + dirZ * dirZ);
    
    // Only follow and rotate if not too close to avoid jittering
    if (distance > 1.5) {
      // Calculate the angle from pet to player in the XZ plane
      // Add Math.PI to rotate by 180 degrees, aligning the model's -Z axis forward
      const angle = Math.atan2(dirX, dirZ) + Math.PI;
      
      // Convert the angle to a quaternion for rotation
      const halfAngle = angle / 2;
      const qy = Math.sin(halfAngle);
      const qw = Math.cos(halfAngle);
      
      // Apply rotation to make the pet face the player
      pet.setRotation({
        x: 0,
        y: qy,
        z: 0,
        w: qw
      });

      // Normalize direction vector for movement
      const normalizedDirX = dirX / distance;
      const normalizedDirZ = dirZ / distance;
      
      // Move pet towards player with a proper speed
      const speed = Math.min(distance * 0.1, 0.5); // Reduced speed for smoother movement
      
      // Use velocity-based movement
      pet.setLinearVelocity({
        x: normalizedDirX * speed * 10,
        y: 0, // Don't modify vertical velocity to maintain ground contact
        z: normalizedDirZ * speed * 10
      });
      
      // Play movement animation when following
      if (pet === rabbitEntity) {
        pet.stopModelAnimations(['idle']);
        pet.startModelLoopedAnimations(['hop']);
      }
    } else {
      // Stop moving when close enough
      pet.setLinearVelocity({ x: 0, y: 0, z: 0 });
      
      // Play idle animation when not moving
      if (pet === rabbitEntity) {
        pet.stopModelAnimations(['hop']);
        pet.startModelLoopedAnimations(['idle']);
      }
    }
  };

  /**
   * Make a pet follow a player
   */
  const makePetFollow = (pet: Entity, playerEntity: PlayerEntity) => {
    const followState = petFollowStates.get(pet);
    
    if (followState) {
      // If already following this player, stop following
      if (followState.isFollowing && followState.targetPlayerId === playerEntity.player.id) {
        followState.isFollowing = false;
        followState.targetPlayerId = null;
        followState.targetEntity = null;
        
        // Reset to idle animation when stopped following
        if (pet === rabbitEntity) {
          pet.stopModelAnimations(['hop']);
          pet.startModelLoopedAnimations(['idle']);
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
        if (pet === rabbitEntity) {
          pet.stopModelAnimations(['idle']);
          pet.startModelLoopedAnimations(['hop']);
        }
        
        world.chatManager.sendPlayerMessage(
          playerEntity.player, 
          `Pet started following you!`, 
          'FFAA00'
        );
      }
      
      // Increment and save global interaction counter
      totalInteractions++;
      updateGlobalStats();
    }
  };

  /**
   * Create and spawn a rabbit entity
   */
  const rabbitEntity = new Entity({
    modelUri: 'models/npcs/rabbit.gltf',
    modelScale: 1.5,
    modelLoopedAnimations: ['idle'],
    rigidBodyOptions: {
      enabledRotations: { x: false, y: true, z: false },
      mass: 5,
      gravityFactor: 1,
      friction: 0.2,
      restitution: 0.2,
      // Use a larger, non-sensor collider for better visibility and physics
      colliders: [
        {
          shape: ColliderShape.BALL,
          radius: 1.0,
          isSensor: false, // Turn off sensor to ensure proper physics
        }
      ]
    },
  });

  // Spawn rabbit closer to player in a different direction
  rabbitEntity.spawn(world, { x: 5, y: 10, z: 0 });

  // Debug message to console for spawn verification
  console.log('Rabbit entity spawned at:', { x: 5, y: 10, z: 0 });
  
  // Initialize follow state for rabbit
  petFollowStates.set(rabbitEntity, {
    isFollowing: false,
    targetPlayerId: null,
    targetEntity: null,
  });

  // Setup movement update for rabbit pet
  rabbitEntity.on(EntityEvent.TICK, () => {
    const followState = petFollowStates.get(rabbitEntity);
    if (followState?.isFollowing && followState.targetEntity) {
      updatePetMovement(rabbitEntity, followState.targetEntity);
    }
  });

  /**
   * Handle player joining the game
   */
  world.on(PlayerEvent.JOINED_WORLD, ({ player }) => {
    // Create the player entity
    const playerEntity = new PlayerEntity({
      player,
      name: 'Player',
      modelUri: 'models/players/player.gltf',
      modelLoopedAnimations: [ 'idle' ],
      modelScale: 0.5,
    });
  
    playerEntity.spawn(world, { x: 0, y: 10, z: 0 });
    
    // Store the player entity for reference
    playerEntities.set(player.id, playerEntity);
    
    // Load player's saved data
    player.getPersistedData().then(playerData => {
      // Check if player had a pet following them before
      if (playerData && playerData.followingPet === 'rabbit') {
        // Make rabbit follow this player
        const followState = petFollowStates.get(rabbitEntity);
        if (followState) {
          followState.isFollowing = true;
          followState.targetPlayerId = player.id;
          followState.targetEntity = playerEntity;
          
          // Immediately start movement animation when following begins
          rabbitEntity.stopModelAnimations(['idle']);
          rabbitEntity.startModelLoopedAnimations(['hop']);
          
          world.chatManager.sendPlayerMessage(
            player, 
            `Your rabbit remembered you and started following!`, 
            'FFAA00'
          );
        }
      }
    }).catch(error => {
      console.error("Error loading player data:", error);
    });

    // Set up input handling for the player
    const playerController = playerEntity.controller;
    playerController.on(BaseEntityControllerEvent.TICK_WITH_PLAYER_INPUT, ({ entity, input }) => {
      if (input.e) {
        // Check for nearby pets when E is pressed
        const playerPos = entity.position;
        
        // Check rabbit distance
        const rabbitPos = rabbitEntity.position;
        const rabbitDistance = calculateDistance(playerPos, rabbitPos);
        
        // Interaction distance threshold
        const interactionDistance = 10;
        
        // Toggle following for the rabbit if within range
        if (rabbitDistance <= interactionDistance) {
          makePetFollow(rabbitEntity, playerEntity);
          
          // Save player's pet following state
          const followState = petFollowStates.get(rabbitEntity);
          if (followState) {
            // If the pet is now following, save that to player data
            if (followState.isFollowing && followState.targetPlayerId === player.id) {
              player.setPersistedData({ followingPet: 'rabbit' })
                .catch(error => console.error("Error saving player data:", error));
            } else {
              // If the pet stopped following, remove that from player data
              player.setPersistedData({ followingPet: null })
                .catch(error => console.error("Error saving player data:", error));
            }
          }
        } else {
          world.chatManager.sendPlayerMessage(
            player,
            'No pets nearby! Get closer to interact.',
            'FF0000'
          );
        }
        
        // Consume the input
        input.e = false;
      }
    });

    // Load our game UI for this player
    player.ui.load('ui/index.html');
    
    // Send current stats to the new player
    player.ui.postMessage({
      type: 'updateStats',
      totalInteractions
    });

    // Send a welcome message with instructions
    world.chatManager.sendPlayerMessage(player, 'Welcome to the game!', '00FF00');
    world.chatManager.sendPlayerMessage(player, 'Press E when near a pet to make it follow you!', '00FF00');
  });

  /**
   * Handle player leaving the game
   */
  world.on(PlayerEvent.LEFT_WORLD, ({ player }) => {
    // Get all player entities associated with the player who left
    world.entityManager.getPlayerEntitiesByPlayer(player).forEach(entity => entity.despawn());
    
    // Remove player from our tracking map
    playerEntities.delete(player.id);
    
    // Update pet follow states to stop following this player
    for (const [pet, followState] of petFollowStates.entries()) {
      if (followState.targetPlayerId === player.id) {
        followState.isFollowing = false;
        followState.targetPlayerId = null;
        followState.targetEntity = null;
      }
    }
  });

  /**
   * Play some ambient music
   */
  new Audio({
    uri: 'audio/music/hytopia-main.mp3',
    loop: true,
    volume: 0.1,
  }).play(world);
});