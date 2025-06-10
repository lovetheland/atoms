export const vertexShader = `
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
  uniform float brightnessBoost;
  uniform float brightnessSteepness; // Add this line
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

    // Calculate brighten factor based on zoom (0 = no brighten, 1 = max brighten)
    float brightenFactor = clamp(brightnessBoost, 0.0, 1.0);

    // Distribute brightness impact: darkest points get the most, brightest almost none
    // Use a non-linear curve for a smoother falloff, controlled by brightnessSteepness
    float darkness = 1.0 - brightness;
    float impact = pow(darkness, brightnessSteepness) * brightenFactor;

    // Blend color toward white, but only for dark points
    vColor.rgb = mix(vColor.rgb, vec3(1.0), impact);

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
`;

export const fragmentShader = `
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
`;