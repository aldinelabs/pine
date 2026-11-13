/**
 * GLSL ES 1.00 sources for the composer light, so one program compiles in
 * both WebGL2 and WebGL contexts. One full-screen triangle; the fragment
 * shader computes everything analytically from the distance to the text
 * box's rounded outline and the position along it: no textures, no extra
 * passes.
 */

export const COMPOSER_GLOW_VERTEX = /* glsl */ `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const COMPOSER_GLOW_FRAGMENT = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uBuffer;      // drawing buffer, px
uniform float uRatio;      // buffer px per CSS px
uniform vec2 uCenter;      // box centre, canvas CSS px, y down
uniform vec2 uHalf;        // box half size
uniform float uRadius;     // corner radius, <= min(uHalf)
uniform vec4 uMargins;     // room: top, right, bottom, left
uniform float uTime;       // seconds
uniform vec4 uNoise;       // per-run noise offset
uniform vec3 uSpots;       // hot spot positions along the outline, 0-1
uniform vec3 uSpotAmp;     // hot spot brightness
uniform vec3 uSpotWidth;   // hot spot widths, CSS px
uniform float uLevel;      // overall breathing
uniform vec3 uTint0;       // accent
uniform vec3 uTint1;       // warmer
uniform vec3 uTint2;       // cooler
uniform float uDark;       // 1 in dark mode

const float HALF_PI = 1.5707963;
const float TAU = 6.2831853;

float sdRoundBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float valueNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec3(1.0, 0.0, 0.0));
  float c = hash(i + vec3(0.0, 1.0, 0.0));
  float d = hash(i + vec3(1.0, 1.0, 0.0));
  float e = hash(i + vec3(0.0, 0.0, 1.0));
  float g = hash(i + vec3(1.0, 0.0, 1.0));
  float h = hash(i + vec3(0.0, 1.0, 1.0));
  float k = hash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
    mix(mix(e, g, u.x), mix(h, k, u.x), u.y),
    u.z
  );
}

float fbm3(vec3 p) {
  float v = 0.5 * valueNoise(p);
  p = p * 2.03 + vec3(1.7, 9.2, 3.1);
  v += 0.25 * valueNoise(p);
  p = p * 2.01 + vec3(8.3, 2.8, 5.6);
  v += 0.125 * valueNoise(p);
  return v / 0.875;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uBuffer.y - gl_FragCoord.y) / uRatio;
  vec2 p = css - uCenter;
  float d = sdRoundBox(p, uHalf, uRadius);
  // Inside the text box, and beyond the light's reach: nothing to draw.
  if (d < -1.5 || d > 46.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Arc length along the outline, clockwise from the top centre (y down).
  float r = uRadius;
  vec2 e = max(uHalf - r, 0.0);
  float quarter = e.x + HALF_PI * r + e.y;
  vec2 q = abs(p);
  float l;
  if (q.x > e.x && q.y > e.y) {
    l = e.x + r * atan(q.x - e.x, q.y - e.y);
  } else if (q.x <= e.x && (q.y > e.y || uHalf.y - q.y <= uHalf.x - q.x)) {
    l = q.x;
  } else {
    l = e.x + HALF_PI * r + (e.y - q.y);
  }
  float s;
  if (p.x >= 0.0) {
    s = p.y < 0.0 ? l : 2.0 * quarter - l;
  } else {
    s = p.y >= 0.0 ? 2.0 * quarter + l : 4.0 * quarter - l;
  }
  float perimeter = max(4.0 * quarter, 1.0);
  float u = s / perimeter;

  // Seamless noise round the loop: u lies on a circle, and the third axis
  // carries the distance outward and time. The pattern flows clockwise.
  float radius = perimeter / (TAU * 90.0);
  float a = TAU * (u - 0.035 * uTime);
  vec3 c = vec3(cos(a) * radius, sin(a) * radius, d / 22.0 - 0.18 * uTime)
    + uNoise.xyz * 37.0;
  vec3 w = vec3(
    fbm3(c * 0.6 + vec3(0.0, 0.0, 0.11 * uTime)),
    fbm3(c * 0.6 + vec3(5.2, 1.3, 2.8 + uNoise.w)),
    0.0
  );
  float n = fbm3(c + 1.6 * w);

  // Hot spots: wrapped distance along the outline.
  vec3 ds = abs(fract(u - uSpots + 0.5) - 0.5) * perimeter;
  vec3 spot3 = uSpotAmp * exp(-(ds * ds) / (uSpotWidth * uSpotWidth));
  float spot = spot3.x + spot3.y + spot3.z;

  float outd = max(d, 0.0);
  float inner = smoothstep(-1.5, 0.0, d);
  float rim = inner * exp(-outd / 1.6);
  float reach = mix(9.0, 34.0, clamp(spot, 0.0, 1.0)) * (0.7 + 0.6 * n);
  float bloom = inner * exp(-outd / reach)
    / (1.0 + outd * outd / (reach * reach * 0.6));
  float flick = 0.6 + 0.8 * n;

  // How much of each tint lands here.
  float w0 = (rim * (0.55 + 0.9 * spot3.x) + bloom * (0.16 + 0.55 * spot3.x)) * flick;
  float w1 = (rim * 0.9 + bloom * 0.6) * spot3.y * flick
    + bloom * 0.12 * smoothstep(0.55, 0.85, n);
  float w2 = (rim * 0.9 + bloom * 0.6) * spot3.z * flick;

  // Fade to nothing at the canvas edges, across whatever room there is.
  vec2 size = uBuffer / uRatio;
  float fade = smoothstep(0.0, 1.0, css.y / max(uMargins.x, 1.0))
    * smoothstep(0.0, 1.0, (size.x - css.x) / max(uMargins.y, 1.0))
    * smoothstep(0.0, 1.0, (size.y - css.y) / max(uMargins.z, 1.0))
    * smoothstep(0.0, 1.0, css.x / max(uMargins.w, 1.0));
  float scale = uLevel * fade;

  if (uDark > 0.5) {
    // Dark: additive light with a white-hot core where a hot spot crosses
    // the rim, tone-mapped and premultiplied so no channel exceeds alpha.
    vec3 light = (uTint0 * w0 + uTint1 * w1 + uTint2 * w2
      + vec3(rim * spot * 0.45)) * scale * 1.7;
    float alpha = 1.0 - exp(-max(max(light.r, light.g), light.b));
    vec3 col = 1.0 - exp(-light);
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
  } else {
    // Light: the tints themselves laid over the page by coverage, so a
    // grey or olive stays grey or olive on white instead of lifting to its
    // brightest (and on white, invisible) version.
    float weight = w0 + w1 + w2;
    vec3 tint = (uTint0 * w0 + uTint1 * w1 + uTint2 * w2) / max(weight, 1e-4);
    float alpha = 1.0 - exp(-weight * scale * 1.1);
    gl_FragColor = vec4(tint * alpha, alpha);
  }
}
`;
