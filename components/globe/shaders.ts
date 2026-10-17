export const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

export const earthFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uLightIntensity;
  uniform float uAmbient;
  uniform float uNightLights;
  uniform vec3 uAtmosphere;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 n = normalize(vWorldNormal);
    float d = dot(n, normalize(uLightDir));
    float lit = smoothstep(-0.18, 0.4, d);

    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;

    vec3 color = day * uLightColor * (uAmbient + lit * uLightIntensity);
    color += night * vec3(1.0, 0.8, 0.52) * (1.0 - lit) * uNightLights * 1.6;

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
    color += uAtmosphere * fresnel * (0.12 + 0.35 * lit);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const atmosphereFragment = /* glsl */ `
  uniform vec3 uAtmosphere;
  uniform float uStrength;
  varying vec3 vNormal;
  void main() {
    float intensity = pow(max(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 2.6);
    gl_FragColor = vec4(uAtmosphere, 1.0) * intensity * uStrength;
    #include <colorspace_fragment>
  }
`
