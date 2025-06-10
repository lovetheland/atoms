import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { vertexShader, fragmentShader } from './shaders.js';

// Import the image using Vite's asset handling
import imagePath from './image.jpg?url';

// --- Configurable Variables ---
const CONFIG = {
  frustumSize: 1, // FOV
  zoomStep: 0.02,
  minZoom: 0.1,
  zoomDamping: 0.05,
  panDamping: 0.85,
  planeHeight: 2,
  cameraZ: 5,
  imagePath: imagePath, // Use the imported image path
  pointSize: 1.0,
  planeSubdivisions: 256,
  // texturePlaneVisibilityZoomThreshold: 4.0, // Added: Zoom level to hide texture plane // Will be replaced
  texturePlaneFadeStartZoom: 4.0, // Zoom level where texture plane starts to fade
  texturePlaneFadeEndZoom: 12.0,  // Zoom level where texture plane is fully transparent

  // Shader parameters for brightness-based point size
  brightnessMultiplier: 8.5,
  minPointSizeFactor: 1.0,
  pointEdgeSoftness: 0.0, // Softness of point edges (0.0 = hard edges, 1.0 = very soft)
  
  // Zoom threshold for point size variation
  zoomThreshold: 1.0,             // Below this zoom level, all points are uniform size
  maxZoomForSizeTransition: 5.0,  // Full brightness-based sizing at this zoom level
  
  // Point displacement (linear implementation)
  displacementAmount: 0.005,
  displacementStartZoom: 5.0,     // Start displacement at this zoom level (0%)
  displacementFullZoom: 1000.0,    // Full displacement at this zoom level (100%)

  // Displacement Jitter (oscillates the magnitude of displacement)
  displacementJitterMagnitude: 0.8, // e.g., 0.2 means displacement oscillates +/- 20%
  displacementJitterSpeed: 1.0,     // Speed of the displacement magnitude oscillation

  // Controls how strongly zoom brightens dark points (default 1.0)
  brightnessBoost: -0.05,
  brightnessBoostStartZoom: 10.0, // Zoom level where brightness boost begins
  brightnessBoostEnabled: true,  // Toggle brightness boost effect on/off

  // Brightness steepness control
  brightnessSteepness: 4.0, // 1.0 = linear, 2.0 = quadratic, higher = steeper
  
  // Camera auto-movement
  autoMovementEnabled: true,        // Toggle auto-movement on/off
  autoMovementSpeed: 0.004,        // Speed of camera drift
  autoMovementBufferAmount: 0.98,   // Smoothing factor (0-1, higher = smoother)
  autoMovementEdgeThreshold: 0.15,  // Distance from edge to start avoiding (0-1)
  autoMovementEdgeForce: 0.05,      // Strength of edge avoidance
  autoMovementChangeRate: 0.0005,     // Probability of changing direction each frame
  
  // Auto-zoom settings
  autoZoomEnabled: true,            // Toggle auto-zoom on/off
  autoZoomSpeed: 0.015,            // Base speed of zooming
  autoZoomSpeedVariability: 0.2,    // Random variation in zoom speed (±20%)
  autoZoomBufferAmount: 0.95,      // Smoothing factor (0-1, higher = smoother)
  autoZoomMinLevel: 1.0,            // Minimum zoom level for auto-zoom
  autoZoomMaxLevel: 80.0,            // Maximum zoom level for auto-zoom
  autoZoomChangeRate: 0.001         // Probability of changing zoom direction each frame
};

// --- State Variables ---
let scene, camera, renderer;
let stats;
let isDragging = false;
let lastMouse = { x: 0, y: 0 };
let targetZoom, zoomVelocity;
let targetPosition = { x: 0, y: 0 };
let panVelocity = { x: 0, y: 0 };

let densePointsMesh;
let texturePlaneMesh; // Added for the texture plane
let imageDimensions = { width: 0, height: 0 };
let calculatedPlaneWidth = 0;

// Auto-movement vectors
let autoMovementVector = { x: 0, y: 0 };
let targetAutoMovementVector = { x: 0, y: 0 };

// Auto-zoom variables
let autoZoomDirection = 1;         // 1 = zoom in, -1 = zoom out
let targetAutoZoomDirection = 1;   // Target direction
let autoZoomVelocity = 0;          // Current zoom velocity
let lastAutoZoomTime = 0;          // For time-based fluctuations

// --- Initialization ---
function init() {
  setupScene();
  setupCamera();
  setupRenderer();
  setupStats();
  loadImage(CONFIG.imagePath);
  setupEventListeners();
  
  // Initialize auto-movement with random direction
  initializeAutoMovement();
  initializeAutoZoom();
  
  lastAutoZoomTime = Date.now();
}

// New function to initialize auto-movement
function initializeAutoMovement() {
  // Random direction
  const angle = Math.random() * Math.PI * 2;
  targetAutoMovementVector = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  
  // Initialize current vector to match target
  autoMovementVector = { ...targetAutoMovementVector };
}

// Initialize auto-zoom
function initializeAutoZoom() {
  // Set initial zoom level to 2
  camera.zoom = 1;
  targetZoom = 1;

  // Random starting direction (in or out)
  targetAutoZoomDirection = Math.random() > 0.5 ? 1 : -1;
  autoZoomDirection = targetAutoZoomDirection;
  autoZoomVelocity = 0;
}

// --- Scene Setup ---
function setupScene() {
  scene = new THREE.Scene();
}

// --- Camera Setup ---
function setupCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.OrthographicCamera(
    -CONFIG.frustumSize * aspect, CONFIG.frustumSize * aspect,
    CONFIG.frustumSize, -CONFIG.frustumSize,
    0.1, 100
  );
  camera.position.set(0, 0, CONFIG.cameraZ);
  camera.lookAt(0, 0, 0);
  targetZoom = camera.zoom;
  targetPosition = { x: camera.position.x, y: camera.position.y };
  zoomVelocity = 0;
}

// --- Renderer Setup ---
function setupRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
}

// --- Stats Setup ---
function setupStats() {
  stats = new Stats();
  stats.domElement.style.position = 'absolute';
  stats.domElement.style.top = '0px';
  stats.domElement.style.left = '0px';
  document.body.appendChild(stats.domElement);
  
  // Create zoom counter element
  const zoomCounter = document.createElement('div');
  zoomCounter.id = 'zoom-counter';
  zoomCounter.style.position = 'absolute';
  zoomCounter.style.top = '10px';
  zoomCounter.style.right = '10px';
  zoomCounter.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  zoomCounter.style.color = 'white';
  zoomCounter.style.padding = '8px 12px';
  zoomCounter.style.borderRadius = '4px';
  zoomCounter.style.fontFamily = 'monospace';
  zoomCounter.style.fontSize = '14px';
  zoomCounter.style.userSelect = 'none';
  zoomCounter.style.zIndex = '1000';
  zoomCounter.textContent = 'Zoom: 1.00';
  document.body.appendChild(zoomCounter);
}

// --- Load Image and Create Mesh ---
function loadImage(path) {
  const loader = new THREE.TextureLoader();
  loader.load(path, (texture) => {
    imageDimensions.width = texture.image.width;
    imageDimensions.height = texture.image.height;
    const imageAspect = imageDimensions.width / imageDimensions.height;
    calculatedPlaneWidth = CONFIG.planeHeight * imageAspect;

    // Dense Points Mesh (one point per image pixel)
    const pointPositions = [];
    const pointUvs = [];
    const numPointsX = imageDimensions.width;
    const numPointsY = imageDimensions.height;

    for (let iy = 0; iy < numPointsY; iy++) {
      for (let ix = 0; ix < numPointsX; ix++) {
        // Center of texel UV calculation
        const u = (ix + 0.5) / numPointsX;
        const v = (iy + 0.5) / numPointsY;
        const x = (u - 0.5) * calculatedPlaneWidth;
        const y = (v - 0.5) * CONFIG.planeHeight; 
        pointPositions.push(x, y, 0);
        pointUvs.push(u, v);
      }
    }

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
    pointsGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(pointUvs, 2));
    
    // Brightness-based point size shader material
    const brightnessPointsMaterial = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        basePointSize: { value: CONFIG.pointSize },
        brightnessMultiplier: { value: CONFIG.brightnessMultiplier },
        minPointSize: { value: CONFIG.pointSize * 0.8 },
        displacementAmount: { value: CONFIG.displacementAmount },
        seed: { value: Math.random() * 100 },
        cameraZoom: { value: camera.zoom },
        screenWidth: { value: window.innerWidth },
        screenHeight: { value: window.innerHeight },
        imageWidth: { value: imageDimensions.width },
        imageHeight: { value: imageDimensions.height },
        planeWidth: { value: calculatedPlaneWidth },
        planeHeight: { value: CONFIG.planeHeight },
        zoomThreshold: { value: CONFIG.zoomThreshold },
        maxZoomForSizeTransition: { value: CONFIG.maxZoomForSizeTransition },
        displacementStartZoom: { value: CONFIG.displacementStartZoom },
        displacementHalfwayZoom: { value: CONFIG.displacementHalfwayZoom },
        displacementFullZoom: { value: CONFIG.displacementFullZoom },
        pointEdgeSoftness: { value: CONFIG.pointEdgeSoftness },
        time: { value: 0.0 }, // Time uniform for jitter
        displacementJitterMagnitude: { value: CONFIG.displacementJitterMagnitude },
        displacementJitterSpeed: { value: CONFIG.displacementJitterSpeed },
        brightnessBoost: { value: CONFIG.brightnessBoost },
        brightnessSteepness: { value: CONFIG.brightnessSteepness }, // Add this line
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      transparent: true
    });
    
    densePointsMesh = new THREE.Points(pointsGeometry, brightnessPointsMaterial);
    scene.add(densePointsMesh);

    // Texture Plane Mesh
    // Clone the texture to avoid modifying the original texture used by points
    const planeTexture = texture.clone();
    planeTexture.colorSpace = THREE.SRGBColorSpace; 
    const planeGeometry = new THREE.PlaneGeometry(calculatedPlaneWidth, CONFIG.planeHeight);
    const planeMaterial = new THREE.MeshBasicMaterial({ 
      map: planeTexture,
      transparent: true, // Enable transparency
      opacity: 1.0       // Initial opacity
    });
    texturePlaneMesh = new THREE.Mesh(planeGeometry, planeMaterial);
    texturePlaneMesh.position.z = 1.0; // Position 1.0 unit "above" (along +Z) the points mesh
    scene.add(texturePlaneMesh);
    
    animate();
  },
  undefined, // onProgress callback
  (error) => {
    console.error('An error occurred loading the texture:', error);
  });
}

// --- Event Listeners ---
function setupEventListeners() {
  window.addEventListener('wheel', onWheel, { passive: false });
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('resize', onResize);
}

// --- Wheel Zoom Handler ---
function onWheel(event) {
  event.preventDefault();
  const mouseNDC = {
    x: (event.clientX / window.innerWidth) * 2 - 1,
    y: -(event.clientY / window.innerHeight) * 2 + 1,
  };
  const mouseWorld = {
    x: mouseNDC.x * (camera.right - camera.left) / 2 / camera.zoom + camera.position.x,
    y: mouseNDC.y * (camera.top - camera.bottom) / 2 / camera.zoom + camera.position.y,
  };
  const direction = Math.sign(-event.deltaY);
  zoomVelocity += direction * CONFIG.zoomStep * camera.zoom;
  const zoomFactor = direction * CONFIG.zoomStep;
  targetPosition.x += zoomFactor * (mouseWorld.x - camera.position.x);
  targetPosition.y += zoomFactor * (mouseWorld.y - camera.position.y);
}

// --- Mouse Drag Handlers ---
function onMouseDown(event) {
  isDragging = true;
  lastMouse.x = event.clientX;
  lastMouse.y = event.clientY;
  panVelocity.x = 0;
  panVelocity.y = 0;
}
function onMouseUp() {
  isDragging = false;
}
function onMouseMove(event) {
  if (!isDragging) return;
  const dx = (event.clientX - lastMouse.x) / window.innerWidth;
  const dy = (event.clientY - lastMouse.y) / window.innerHeight;
  const panX = -dx * (camera.right - camera.left) / camera.zoom;
  const panY =  dy * (camera.top - camera.bottom) / camera.zoom;
  camera.position.x += panX;
  camera.position.y += panY;
  targetPosition.x = camera.position.x;
  targetPosition.y = camera.position.y;
  camera.updateProjectionMatrix();
  panVelocity.x = panX;
  panVelocity.y = panY;
  lastMouse.x = event.clientX;
  lastMouse.y = event.clientY;
}

// --- Window Resize Handler ---
function onResize() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -CONFIG.frustumSize * aspect;
  camera.right = CONFIG.frustumSize * aspect;
  camera.top = CONFIG.frustumSize;
  camera.bottom = -CONFIG.frustumSize;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  
  // Update shader uniforms with new screen dimensions
  if (densePointsMesh) {
    densePointsMesh.material.uniforms.screenWidth.value = window.innerWidth;
    densePointsMesh.material.uniforms.screenHeight.value = window.innerHeight;
  }
}

// --- Camera Orientation ---
function enforceCameraOrientation() {
  camera.position.z = CONFIG.cameraZ;
  camera.lookAt(camera.position.x, camera.position.y, 0);
  camera.up.set(0, 1, 0);
}

// --- Momentum Zoom Update ---
function updateZoom() {
  if (Math.abs(zoomVelocity) > 0.0001) {
    targetZoom += zoomVelocity;
    if (targetZoom < CONFIG.minZoom) {
      targetZoom = CONFIG.minZoom;
      zoomVelocity = 0;
    }
    zoomVelocity *= CONFIG.zoomDamping;
  } else {
    zoomVelocity = 0;
  }
  camera.zoom += (targetZoom - camera.zoom) * 0.2;
  camera.zoom = Math.max(CONFIG.minZoom, camera.zoom);
  camera.position.x += (targetPosition.x - camera.position.x) * 0.2;
  camera.position.y += (targetPosition.y - camera.position.y) * 0.2;
  camera.updateProjectionMatrix();
}

// --- Momentum Pan Update ---
function updatePan() {
  if (!isDragging && (Math.abs(panVelocity.x) > 0.00001 || Math.abs(panVelocity.y) > 0.00001)) {
    targetPosition.x += panVelocity.x;
    targetPosition.y += panVelocity.y;
    panVelocity.x *= CONFIG.panDamping;
    panVelocity.y *= CONFIG.panDamping;
  } else if (!isDragging) {
    panVelocity.x = 0;
    panVelocity.y = 0;
  }
}

// --- Auto Movement Update ---
function updateAutoMovement() {
  if (!CONFIG.autoMovementEnabled || isDragging) return;

  // Occasionally change the target direction
  if (Math.random() < CONFIG.autoMovementChangeRate) {
    const angle = Math.random() * Math.PI * 2;
    targetAutoMovementVector = {
      x: Math.cos(angle),
      y: Math.sin(angle)
    };
  }

  // Smooth out changes with interpolation
  const smoothingFactor = 0.1; // Adjust for smoother transitions (lower = smoother)
  autoMovementVector.x += (targetAutoMovementVector.x - autoMovementVector.x) * smoothingFactor;
  autoMovementVector.y += (targetAutoMovementVector.y - autoMovementVector.y) * smoothingFactor;

  // Check if approaching edges and steer back toward the mesh
  const visibleWidth = (camera.right - camera.left) / camera.zoom;
  const visibleHeight = (camera.top - camera.bottom) / camera.zoom;

  const maxX = calculatedPlaneWidth / 2 - visibleWidth * CONFIG.autoMovementEdgeThreshold;
  const minX = -calculatedPlaneWidth / 2 + visibleWidth * CONFIG.autoMovementEdgeThreshold;
  const maxY = CONFIG.planeHeight / 2 - visibleHeight * CONFIG.autoMovementEdgeThreshold;
  const minY = -CONFIG.planeHeight / 2 + visibleHeight * CONFIG.autoMovementEdgeThreshold;

  const edgeMomentumFactor = CONFIG.autoMovementEdgeForce * 2; // Stronger force to steer back

  if (camera.position.x > maxX) {
    autoMovementVector.x -= edgeMomentumFactor * (camera.position.x - maxX);
  }
  if (camera.position.x < minX) {
    autoMovementVector.x += edgeMomentumFactor * (minX - camera.position.x);
  }
  if (camera.position.y > maxY) {
    autoMovementVector.y -= edgeMomentumFactor * (camera.position.y - maxY);
  }
  if (camera.position.y < minY) {
    autoMovementVector.y += edgeMomentumFactor * (minY - camera.position.y);
  }

  // Normalize the vector to maintain consistent speed
  const length = Math.sqrt(
    autoMovementVector.x * autoMovementVector.x +
    autoMovementVector.y * autoMovementVector.y
  );
  if (length > 0) {
    autoMovementVector.x /= length;
    autoMovementVector.y /= length;
  }

  // Apply movement to target position
  const scaledSpeed = CONFIG.autoMovementSpeed / camera.zoom;
  targetPosition.x += autoMovementVector.x * scaledSpeed;
  targetPosition.y += autoMovementVector.y * scaledSpeed;
}

// --- Auto Zoom Update ---
function updateAutoZoom() {
  if (!CONFIG.autoZoomEnabled || isDragging) return;

  // Occasionally change the zoom direction
  if (Math.random() < CONFIG.autoZoomChangeRate) {
    targetAutoZoomDirection = -targetAutoZoomDirection; // Reverse direction
  }

  // Smooth direction changes with interpolation
  const smoothingFactor = 0.1; // Adjust for smoother transitions (lower = smoother)
  autoZoomDirection += (targetAutoZoomDirection - autoZoomDirection) * smoothingFactor;

  // Calculate current zoom limits based on configuration
  if ((camera.zoom >= CONFIG.autoZoomMaxLevel && autoZoomDirection > 0) ||
      (camera.zoom <= CONFIG.autoZoomMinLevel && autoZoomDirection < 0)) {
    // If we hit a limit, reverse direction
    targetAutoZoomDirection = -targetAutoZoomDirection;
  }

  // Apply speed variability with time-based randomness
  const timeDelta = (Date.now() - lastAutoZoomTime) / 1000;
  lastAutoZoomTime = Date.now();

  const zoomVariability = 1 + (Math.sin(Date.now() * 0.001) * CONFIG.autoZoomSpeedVariability);
  const normalizedZoomSpeed = CONFIG.autoZoomSpeed * zoomVariability / camera.zoom; // Normalize speed by zoom level
  const variableZoomSpeed = normalizedZoomSpeed * timeDelta * 60;

  // Update the zoom velocity based on direction and normalized speed
  autoZoomVelocity = autoZoomDirection * variableZoomSpeed;

  // Apply zoom velocity to target zoom
  targetZoom += autoZoomVelocity;

  // Ensure zoom stays within defined limits
  targetZoom = Math.max(CONFIG.autoZoomMinLevel, Math.min(CONFIG.autoZoomMaxLevel, targetZoom));
}

// --- Animation Loop ---
function animate() {
  updateZoom();
  updatePan();
  updateAutoMovement();
  updateAutoZoom(); // Add auto-zoom update
  enforceCameraOrientation();
  
  // Update shader uniforms for LOD
  if (densePointsMesh) {
    densePointsMesh.material.uniforms.cameraZoom.value = camera.zoom;
    densePointsMesh.material.uniforms.screenWidth.value = window.innerWidth;
    densePointsMesh.material.uniforms.screenHeight.value = window.innerHeight;
    densePointsMesh.material.uniforms.zoomThreshold.value = CONFIG.zoomThreshold;
    densePointsMesh.material.uniforms.maxZoomForSizeTransition.value = CONFIG.maxZoomForSizeTransition;
    densePointsMesh.material.uniforms.displacementStartZoom.value = CONFIG.displacementStartZoom;
    densePointsMesh.material.uniforms.displacementHalfwayZoom.value = CONFIG.displacementHalfwayZoom;
    densePointsMesh.material.uniforms.displacementFullZoom.value = CONFIG.displacementFullZoom;
    densePointsMesh.material.uniforms.time.value += 0.016;
    densePointsMesh.material.uniforms.displacementJitterMagnitude.value = CONFIG.displacementJitterMagnitude;
    densePointsMesh.material.uniforms.displacementJitterSpeed.value = CONFIG.displacementJitterSpeed;

    // --- Brightness boost ramps up with zoom, starting at brightnessBoostStartZoom ---
    const boostStart = CONFIG.brightnessBoostStartZoom;
    const boostEnd = CONFIG.maxZoomForSizeTransition;
    let boostFactor = 0.0;
    if (camera.zoom > boostStart) {
      boostFactor = Math.min(1, (camera.zoom - boostStart) / (boostEnd - boostStart));
    }
    densePointsMesh.material.uniforms.brightnessBoost.value = CONFIG.brightnessBoostEnabled
      ? CONFIG.brightnessBoost * boostFactor
      : 0.0;
  }

  // Update visibility and opacity of the texture plane mesh
  if (texturePlaneMesh && texturePlaneMesh.material) {
    const zoom = camera.zoom;
    const startFade = CONFIG.texturePlaneFadeStartZoom;
    const endFade = CONFIG.texturePlaneFadeEndZoom;

    if (zoom < startFade) {
      texturePlaneMesh.material.opacity = 1.0;
      texturePlaneMesh.visible = true;
    } else if (zoom > endFade) {
      texturePlaneMesh.material.opacity = 0.0;
      texturePlaneMesh.visible = false; 
    } else {
      // Calculate opacity: 1 at startFade, 0 at endFade
      const opacity = 1.0 - (zoom - startFade) / (endFade - startFade);
      texturePlaneMesh.material.opacity = Math.max(0, Math.min(1, opacity)); // Clamp between 0 and 1
      texturePlaneMesh.visible = texturePlaneMesh.material.opacity > 0.001; // Hide if nearly fully transparent
    }
    texturePlaneMesh.material.needsUpdate = true; // Important if material properties change
  }

  // Update zoom counter
  const zoomCounter = document.getElementById('zoom-counter');
  if (zoomCounter) {
    // Calculate zoom factor (0 to 1) for the transition range
    const zoomFactor = Math.min(1, Math.max(0, 
      (camera.zoom - CONFIG.zoomThreshold) / 
      (CONFIG.maxZoomForSizeTransition - CONFIG.zoomThreshold)
    ));
    
    // Simple linear displacement factor calculation
    let displacementFactor = Math.min(1, Math.max(0,
      (camera.zoom - CONFIG.displacementStartZoom) / 
      (CONFIG.displacementFullZoom - CONFIG.displacementStartZoom)
    ));
    
    // Show both raw zoom and the transition factors
    zoomCounter.textContent = `Zoom: ${camera.zoom.toFixed(2)} | Factor: ${zoomFactor.toFixed(2)}`;
    
    // Visualize the displacement scaling with linear curve
    const displacement = CONFIG.displacementAmount * displacementFactor * 5.0;
    zoomCounter.textContent += ` | Disp: ${displacement.toFixed(6)} (${displacementFactor.toFixed(2)})`;
  }
  
  renderer.render(scene, camera);
  stats.update();
  requestAnimationFrame(animate);
}

// --- Start ---
init();