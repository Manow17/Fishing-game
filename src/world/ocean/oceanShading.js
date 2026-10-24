// Shared look of sea water for everything that can sit below the surface (sea bed, rocks, coral,
// harbour walls) and for the water surface itself, so shallow water and the opaque deep body match.
import * as THREE from 'three';

// Per-metre extinction of light in clear tropical water (red goes first -> turquoise over sand),
// and the radiance of an infinitely deep column (what the open ocean converges to).
export const WATER = {
  sigma: new THREE.Vector3(0.40, 0.068, 0.042),
  inscatter: new THREE.Color(0.0045, 0.040, 0.078),
};

export function waterUniforms(sharedTime, noiseTex, sunDir) {
  return {
    uTime: sharedTime,
    tCausticNoise: { value: noiseTex },
    uSigma: { value: WATER.sigma },
    uInscatter: { value: WATER.inscatter },
    uSunDirW: { value: sunDir },
  };
}

// Declarations (fragment). Requires uniforms from waterUniforms().
export const UNDERWATER_PARS = /* glsl */`
  uniform float uTime;
  uniform sampler2D tCausticNoise;
  uniform vec3 uSigma, uInscatter, uSunDirW;
  float causticAt(vec2 p, float t) {
    float c1 = texture2D(tCausticNoise, p * 0.55 + vec2(t * 0.045, t * 0.027)).r;
    float c2 = texture2D(tCausticNoise, p * 0.63 + vec2(-t * 0.036, t * 0.05) + 0.37).r;
    float r = 1.0 - abs(c1 - c2) * 5.5;
    return pow(clamp(r, 0.0, 1.0), 5.0);
  }
  // caustic light patterns on surfaces below y = 0 (added to albedo, i.e. lit by the sun)
  float causticsWorld(vec3 wp, vec3 wn) {
    float dep = -wp.y;
    if (dep <= 0.0) return 0.0;
    float c = causticAt(wp.xz, uTime) + 0.6 * causticAt(wp.xz * 1.7 + 3.0, uTime * 1.3);
    // the pattern blurs out with depth and with distance from the camera (it would only alias)
    float far = 1.0 - smoothstep(40.0, 160.0, length(cameraPosition - wp));
    return c * far * exp(-dep * 0.12) * smoothstep(0.0, 0.6, dep) * clamp(wn.y * 0.8 + 0.2, 0.0, 1.0);
  }
  // light reaching an underwater point and coming back to an above-water camera
  vec3 underwater(vec3 col, vec3 wp) {
    float dep = -wp.y;
    if (dep <= 0.0) return col;
    vec3 V = cameraPosition - wp;
    float vl = length(V);
    V /= max(vl, 1e-4);
    // path from the surface to the point along the view ray (camera above water), clamped at grazing angles
    float camUnder = step(cameraPosition.y, 0.0);
    float Lv = mix(dep / max(V.y, 0.06), vl, camUnder);
    Lv = min(Lv, 400.0);
    float Ll = dep / max(uSunDirW.y, 0.25);
    vec3 T = exp(-uSigma * min(Lv + Ll, 400.0));
    vec3 Tv = exp(-uSigma * 0.55 * Lv);
    float edge = smoothstep(0.0, 0.25, dep);       // no hard line at the waterline
    vec3 res = col * T + uInscatter * (1.0 - Tv);
    return mix(col, res, edge);
  }
`;

// Patch a MeshStandard/Physical material so whatever sits below y = 0 gets the water's absorption and
// in-scatter along the view path (and sun caustics when caustics = true). Works with instancing.
export function withUnderwater(mat, waterU, key, { caustics = false } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, waterU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vUwPos;
        varying vec3 vUwN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 uwp = vec4(transformed, 1.0);
        vec3 uwn = objectNormal;
        #ifdef USE_INSTANCING
          uwp = instanceMatrix * uwp;
          uwn = mat3(instanceMatrix) * uwn;
        #endif
        vUwPos = (modelMatrix * uwp).xyz;
        vUwN = normalize(mat3(modelMatrix) * uwn);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vUwPos;
        varying vec3 vUwN;
        ${UNDERWATER_PARS}`)
      .replace('#include <fog_fragment>', `gl_FragColor.rgb = underwater(gl_FragColor.rgb, vUwPos);
        #include <fog_fragment>`);
    if (caustics) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb += diffuseColor.rgb * causticsWorld(vUwPos, normalize(vUwN)) * 0.9;`);
    }
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
