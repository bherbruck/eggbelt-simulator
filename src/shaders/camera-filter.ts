import * as THREE from 'three'

export const CameraFilterShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uEnabled: { value: 1 },
    uPixelation: { value: 320 },
    uNoise: { value: 0.18 },
    uChromatic: { value: 0.0035 },
    uVignette: { value: 0.55 },
    uExposure: { value: 0.85 },
    uContrast: { value: 1.18 },
    uSaturation: { value: 0.9 },
    uJpegBlock: { value: 0.25 },
    uScanlines: { value: 0.12 },
    uBlur: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uEnabled;
    uniform float uPixelation;
    uniform float uNoise;
    uniform float uChromatic;
    uniform float uVignette;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uJpegBlock;
    uniform float uScanlines;
    uniform float uBlur;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    vec3 sampleCA(vec2 uv, float amt) {
      vec2 dir = uv - 0.5;
      float r = texture2D(tDiffuse, uv + dir * amt).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - dir * amt).b;
      return vec3(r, g, b);
    }

    // 3x3 binomial blur with chromatic aberration baked in.
    // blurR is in pixels.
    vec3 sampleBlurredCA(vec2 uv, float ca, float blurR) {
      if (blurR < 0.001) return sampleCA(uv, ca);
      vec2 px = blurR / uResolution;
      vec3 c = vec3(0.0);
      c += sampleCA(uv + vec2(-px.x, -px.y), ca) * 0.0625;
      c += sampleCA(uv + vec2( 0.0,  -px.y), ca) * 0.125;
      c += sampleCA(uv + vec2( px.x, -px.y), ca) * 0.0625;
      c += sampleCA(uv + vec2(-px.x,  0.0),  ca) * 0.125;
      c += sampleCA(uv,                       ca) * 0.25;
      c += sampleCA(uv + vec2( px.x,  0.0),  ca) * 0.125;
      c += sampleCA(uv + vec2(-px.x,  px.y), ca) * 0.0625;
      c += sampleCA(uv + vec2( 0.0,   px.y), ca) * 0.125;
      c += sampleCA(uv + vec2( px.x,  px.y), ca) * 0.0625;
      return c;
    }

    void main() {
      vec2 uv = vUv;

      if (uEnabled < 0.5) {
        gl_FragColor = texture2D(tDiffuse, uv);
        return;
      }

      float aspect = uResolution.x / uResolution.y;
      vec2 cells = vec2(uPixelation, uPixelation / aspect);
      vec2 puv = (floor(uv * cells) + 0.5) / cells;

      vec2 blockUv = floor(uv * cells / 8.0);
      float blockJitter = (hash(blockUv) - 0.5) * 0.002 * uJpegBlock;
      puv += blockJitter;

      vec3 col = sampleBlurredCA(puv, uChromatic, uBlur);

      if (uJpegBlock > 0.01) {
        vec2 px = 1.0 / cells;
        vec3 acc = col;
        acc += sampleBlurredCA(puv + vec2( px.x, 0.0), uChromatic, uBlur);
        acc += sampleBlurredCA(puv + vec2(-px.x, 0.0), uChromatic, uBlur);
        acc += sampleBlurredCA(puv + vec2(0.0,  px.y), uChromatic, uBlur);
        acc += sampleBlurredCA(puv + vec2(0.0, -px.y), uChromatic, uBlur);
        acc /= 5.0;
        col = mix(col, acc, clamp(uJpegBlock * 0.6, 0.0, 1.0));
      }

      col *= uExposure;
      col = (col - 0.5) * uContrast + 0.5;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSaturation);

      float n = hash(uv * uResolution + uTime * 60.0) - 0.5;
      col += n * uNoise;

      float scan = sin(uv.y * uResolution.y * 1.8 + uTime * 8.0) * 0.5 + 0.5;
      col *= 1.0 - uScanlines * (1.0 - scan);

      vec2 vd = uv - 0.5;
      float vig = smoothstep(0.85, 0.2, length(vd) * 1.4);
      col *= mix(1.0, vig, uVignette);

      col *= vec3(1.02, 1.0, 0.96);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
}
