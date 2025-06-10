import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';

// --- Configurable Variables ---
const CONFIG = {
  frustumSize: 2, // FOV
  zoomStep: 0.02,
  minZoom: 0.1,
  zoomDamping: 0.05,
  panDamping: 0.85,
  planeHeight: 2,
  cameraZ: 5,
  imagePath: './image.jpg',
  pointSize: 2.0,
  planeSubdivisions: 256,
  
  // Shader parameters for brightness-based point size
  brightnessMultiplier: 1.5,
  minPointSizeFactor: 1.0,
  pointEdgeSoftness: 0.4,
  
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
let imageDimensions = { width: 0, height: 0 };
let calculatedPlaneWidth = 0;

// --- Initialization ---
function init() {
  setupScene();
  setupCamera();
  setupRenderer();
  setupStats();
  loadImage(CONFIG.imagePath);
  setupEventListeners();
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
      },
      vertexShader: `
        uniform sampler2D map;
        uniform float basePointSize;
        uniform float brightnessMultiplier;
        uniform float minPointSize;
        uniform float displacementAmount;
        uniform float seed;
        uniform float cameraZoom;
        uniform float screenWidth;
        uniform float screenHeight;
        uniform float imageWidth;
        uniform float imageHeight;
        uniform float planeWidth;
        uniform float planeHeight;
        uniform float zoomThreshold;
        uniform float maxZoomForSizeTransition;
        uniform float displacementStartZoom;
        uniform float displacementHalfwayZoom;
        uniform float displacementFullZoom;
        uniform float time; // Time for jitter
        uniform float displacementJitterMagnitude;
        uniform float displacementJitterSpeed;
        varying vec2 vUv;
        varying vec4 vColor;
        
        // Pseudo-random number generator
        float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898, 78.233)) + seed) * 43758.5453123);
        }
        
        void main() {
          vUv = uv;
          vColor = texture2D(map, vUv);
          
          // Calculate brightness using luminance formula
          float brightness = dot(vColor.rgb, vec3(0.299, 0.587, 0.114));
          
          // Point culling based on zoom level
          float totalPoints = imageWidth * imageHeight;
          
          // Estimate visible screen pixels for the mesh
          float visiblePixels = (planeWidth * planeHeight * cameraZoom * cameraZoom * screenWidth * screenHeight) / 4.0;
          
          // Calculate sampling rate (what fraction of points to show)
          float samplingRate = min(1.0, visiblePixels / totalPoints);
          
          // Create a deterministic value for each point (0 to 1 range)
          float pointId = random(vUv);
          
          // Discard points based on sampling rate
          if (pointId > samplingRate) {
            // Move point far away to effectively discard it
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          
          // Calculate zoom factor (0 to 1) representing transition between uniform and brightness-based sizing
          float zoomFactor = clamp((cameraZoom - zoomThreshold) / (maxZoomForSizeTransition - zoomThreshold), 0.0, 1.0);
          
          // Simple linear displacement factor (0 to 1)
          float displacementFactor = clamp(
            (cameraZoom - displacementStartZoom) / (displacementFullZoom - displacementStartZoom),
            0.0, 1.0
          );
          
          // Uniform size when zoomed out (zoom factor = 0)
          float uniformSize = minPointSize;
          
          // Brightness-based size when zoomed in (zoom factor = 1)
          float brightnessBasedSize = minPointSize + (basePointSize * brightness * brightnessMultiplier);
          
          // Blend between uniform and brightness-based sizing based on zoom factor
          float sizeBeforeCompensation = mix(uniformSize, brightnessBasedSize, zoomFactor);
          
          // Adjust point size for remaining points (make them slightly larger when sampling fewer points)
          float densityCompensation = sqrt(1.0 / max(0.01, samplingRate));
          gl_PointSize = sizeBeforeCompensation * densityCompensation;
          
          // Generate random displacement values for x and y
          float randX = (random(position.xy + vec2(0.1, 0.3)) * 2.0 - 1.0);
          float randY = (random(position.xy + vec2(0.6, 0.9)) * 2.0 - 1.0);
          
          // Scale displacement by displacement factor - only apply displacement at higher zoom levels
          float scaledDisplacement = displacementAmount * displacementFactor * 5.0;
          
          // Calculate displacement jitter factor (oscillates around 1.0)
          // This factor will modulate the scaledDisplacement.
          // Use a random phase offset for each point to prevent synchronized movement.
          float pointSpecificPhaseOffset = random(position.xy) * 2.0 * 3.1415926535; // Random phase from 0 to 2*PI
          float displacementOscillation = 1.0 + sin(time * displacementJitterSpeed + pointSpecificPhaseOffset) * displacementJitterMagnitude;
          
          // Apply jitter to the scaled displacement only if displacementFactor is active
          float finalScaledDisplacement = scaledDisplacement * (displacementFactor > 0.0 ? displacementOscillation : 1.0);

          // Add displacement to the position, scaled by displacement factor
          vec3 displacedPosition = position + vec3(randX * finalScaledDisplacement, randY * finalScaledDisplacement, 0.0);
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform float pointEdgeSoftness;
        varying vec2 vUv;
        varying vec4 vColor;
        
        void main() {
          // Use the color we sampled in vertex shader
          gl_FragColor = vColor;
          
          // Create circular points by discarding fragments outside radius
          float distance = length(gl_PointCoord - vec2(0.5));
          if (distance > 0.5) {
              discard;
          }
          
          // Apply edge softness based on the config parameter
          float innerEdge = max(0.0, 0.5 - pointEdgeSoftness);
          float alpha = 1.0 - smoothstep(innerEdge, 0.5, distance);
          gl_FragColor.a *= alpha;
        }
      `,
      transparent: true
    });
    
    densePointsMesh = new THREE.Points(pointsGeometry, brightnessPointsMaterial);
    scene.add(densePointsMesh);
    
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

// --- Animation Loop ---
function animate() {
  updateZoom();
  updatePan();
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
    densePointsMesh.material.uniforms.time.value += 0.016; // Increment time (approx. 1/60th of a second)
    densePointsMesh.material.uniforms.displacementJitterMagnitude.value = CONFIG.displacementJitterMagnitude;
    densePointsMesh.material.uniforms.displacementJitterSpeed.value = CONFIG.displacementJitterSpeed;
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