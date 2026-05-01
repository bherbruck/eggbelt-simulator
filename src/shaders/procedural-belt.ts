import * as THREE from 'three'

// fully procedural belt fragment shader. every visual feature is a uniform that
// can be lerped continuously (hole density / size, vertical ribs, fabric weave,
// speckle, grime), so the belt can morph smoothly through infinite styles.
// lighting is computed via simple lambert + ambient — close enough to the rest
// of the scene's PBR feel without baking textures.
export function makeProceduralBeltMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor:   { value: new THREE.Color(0xefe7d2) },
      uTintColor:   { value: new THREE.Color(0xffffff) }, // user tint multiplier

      uHoleAmount:  { value: 0.5 },
      uHoleSize:    { value: 0.32 },
      uHoleStagger: { value: 1.0 },
      uHoleRows:    { value: 12.0 },
      uHoleAspect:  { value: 0.866 }, // hex aspect

      uRibAmount:   { value: 0.0 },
      uRibFreq:     { value: 14.0 },
      uRibPhase:    { value: 0.0 },

      uWeaveAmount: { value: 0.0 },
      uWeaveFreq:   { value: 80.0 },

      uSpeckleAmount: { value: 0.05 },
      uSpeckleScale:  { value: 600.0 },

      uGrimeAmount: { value: 0.15 },
      uGrimeColor:  { value: new THREE.Color(0x4a3520) },
      uGrimeScale:  { value: 6.0 },

      uScratchAmount: { value: 0.05 },

      uOffset: { value: new THREE.Vector2(0, 0) },
      uRepeat: { value: new THREE.Vector2(4, 12) },

      // lighting bound from scene each frame
      uAmbient:       { value: new THREE.Color(0x202028) },
      uKeyDir:        { value: new THREE.Vector3(0, 1, 0) },
      uKeyColor:      { value: new THREE.Color(0xffffff) },
      uKeyIntensity:  { value: 1.0 },
      uFillDir:       { value: new THREE.Vector3(0, 1, 0) },
      uFillColor:     { value: new THREE.Color(0x88aacc) },
      uFillIntensity: { value: 0.3 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying vec3 vWorldNormal;

      uniform vec3 uBaseColor;
      uniform vec3 uTintColor;

      uniform float uHoleAmount;
      uniform float uHoleSize;
      uniform float uHoleStagger;
      uniform float uHoleRows;
      uniform float uHoleAspect;

      uniform float uRibAmount;
      uniform float uRibFreq;
      uniform float uRibPhase;

      uniform float uWeaveAmount;
      uniform float uWeaveFreq;

      uniform float uSpeckleAmount;
      uniform float uSpeckleScale;

      uniform float uGrimeAmount;
      uniform vec3  uGrimeColor;
      uniform float uGrimeScale;

      uniform float uScratchAmount;

      uniform vec2 uOffset;
      uniform vec2 uRepeat;

      uniform vec3 uAmbient;
      uniform vec3 uKeyDir;
      uniform vec3 uKeyColor;
      uniform float uKeyIntensity;
      uniform vec3 uFillDir;
      uniform vec3 uFillColor;
      uniform float uFillIntensity;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i),                  hash21(i + vec2(1.0, 0.0)), u.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }
      float fbm(vec2 p) {
        float a = 0.5, sum = 0.0;
        for (int i = 0; i < 5; i++) {
          sum += vnoise(p) * a;
          p *= 2.02;
          a *= 0.5;
        }
        return sum;
      }

      void main() {
        // tile uvs across the belt surface
        vec2 uv = vUv * uRepeat + uOffset;

        vec3 col = uBaseColor;

        // weave — alternating tight cells
        if (uWeaveAmount > 0.001) {
          vec2 wp = uv * uWeaveFreq;
          vec2 wf = floor(wp);
          float chk = mod(wf.x + wf.y, 2.0);
          // smooth thread crossing intensity within each cell
          vec2 cf = fract(wp) - 0.5;
          float t = 1.0 - abs(cf.x) * abs(cf.y) * 4.0; // bright ridges
          float weaveShade = mix(0.78, 1.08, chk) * mix(0.85, 1.0, t);
          col = mix(col, col * weaveShade, uWeaveAmount);
        }

        // vertical ribs — soft sin profile per period
        if (uRibAmount > 0.001) {
          float ribPos = fract(uv.x * uRibFreq + uRibPhase);
          float rib = sin(ribPos * 3.14159);
          col = mix(col, col * mix(0.55, 1.15, rib), uRibAmount);
        }

        // hex hole grid darkening
        if (uHoleAmount > 0.001) {
          float rows = max(1.0, uHoleRows);
          vec2 hp = uv * vec2(rows / uHoleAspect, rows);
          float row = floor(hp.y);
          hp.x += step(0.5, mod(row, 2.0)) * uHoleStagger * 0.5;
          vec2 hf = fract(hp) - 0.5;
          float d = length(hf);
          float edge = uHoleSize;
          float hole = smoothstep(edge, edge - 0.04, d); // 1 inside, 0 outside
          // dark inner with bright top-left rim
          float rimMix = smoothstep(edge + 0.02, edge - 0.005, d) * (1.0 - hole);
          float rim = clamp(-hf.x - hf.y + 0.6, 0.0, 1.0);
          vec3 holeCol = mix(col, vec3(0.04, 0.04, 0.05), hole);
          holeCol = mix(holeCol, vec3(1.0), rimMix * rim * 0.45);
          col = mix(col, holeCol, uHoleAmount);
        }

        // speckle — high-frequency hash
        if (uSpeckleAmount > 0.001) {
          float s = hash21(floor(uv * uSpeckleScale)) - 0.5;
          col += vec3(s * uSpeckleAmount * 0.6);
        }

        // grime — large-scale fbm darkening with grime color
        if (uGrimeAmount > 0.001) {
          float g = fbm(uv * uGrimeScale);
          g = smoothstep(0.4, 0.85, g);
          col = mix(col, col * uGrimeColor, g * uGrimeAmount);
        }

        // scratches — high-freq directional streaks
        if (uScratchAmount > 0.001) {
          float scr = abs(hash21(floor(uv * vec2(2.0, 200.0))) - 0.5);
          float s = smoothstep(0.45, 0.5, 1.0 - scr);
          col = mix(col, col * 0.8, s * uScratchAmount);
        }

        // user tint (multiplicative)
        col *= uTintColor;

        // lambert + ambient + fill
        vec3 N = normalize(vWorldNormal);
        float kdot = max(dot(N, normalize(uKeyDir)), 0.0);
        float fdot = max(dot(N, normalize(uFillDir)), 0.0);
        vec3 lit = col * uAmbient
                 + col * uKeyColor * (uKeyIntensity * kdot)
                 + col * uFillColor * (uFillIntensity * fdot);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  })
}

// random target picker for procedural belt uniforms — used by generalize mode
export function pickProceduralBeltTarget(): {
  baseColor: string
  tintColor: string
  holeAmount: number
  holeSize: number
  holeStagger: number
  holeRows: number
  ribAmount: number
  ribFreq: number
  ribPhase: number
  weaveAmount: number
  weaveFreq: number
  speckleAmount: number
  speckleScale: number
  grimeAmount: number
  grimeColor: string
  grimeScale: number
  scratchAmount: number
} {
  const r = (a: number, b: number) => a + Math.random() * (b - a)
  const randHexNorm = (lo: number, hi: number) => {
    const v = (n: number) => Math.floor(lo + Math.random() * (hi - lo)).toString(16).padStart(2, '0').slice(0, 2)
    return '#' + v(0) + v(0) + v(0)
  }
  // mix of baseColor randomness — bias toward off-white plastic / fabric / metal
  const palette = ['#f0e8d4', '#ddd8c4', '#c8c4b8', '#e2dccc', '#a89c84', '#d8cc88', '#b8a890', '#444447', '#3a3a3e']
  const palette2 = ['#4a3520', '#382a18', '#2a1a08', '#5a4830', '#7a5b34', '#1a1a1c']

  return {
    baseColor: palette[Math.floor(Math.random() * palette.length)],
    tintColor: Math.random() < 0.6 ? '#ffffff' : randHexNorm(180, 250),
    holeAmount:    Math.random() < 0.5 ? r(0.6, 1.0) : 0,
    holeSize:      r(0.18, 0.42),
    holeStagger:   Math.random() < 0.7 ? 1.0 : 0.0,
    holeRows:      r(6, 24),
    ribAmount:     Math.random() < 0.3 ? r(0.2, 0.8) : 0,
    ribFreq:       r(4, 30),
    ribPhase:      Math.random(),
    weaveAmount:   Math.random() < 0.4 ? r(0.3, 1.0) : 0,
    weaveFreq:     r(40, 220),
    speckleAmount: r(0, 0.18),
    speckleScale:  r(200, 900),
    grimeAmount:   r(0, 0.5),
    grimeColor:    palette2[Math.floor(Math.random() * palette2.length)],
    grimeScale:    r(2, 14),
    scratchAmount: r(0, 0.4),
  }
}
