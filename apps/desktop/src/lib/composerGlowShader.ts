/**
 * GLSL ES 1.00 sources for the composer light, so one program compiles in
 * both WebGL2 and WebGL contexts. One full-screen triangle; the fragment
 * shader computes everything analytically from the distance to the text
 * box's rounded outline and the position along it: no textures, no extra
 * passes.
 *
 * The look: a soft band of coloured light hugs the whole outline, and two
 * brighter swells travel round it clockwise (the main one and a fainter one
 * half a lap behind), so the light reads as circling the text box. Noise
 * that drifts with the swells changes how far the light reaches and how
 * bright it is along the outline; it never moves the light off its path.
 * There is no drawn rim: the light is brightest at the text box's edge and
 * falls off smoothly outward, so nothing reads as a border line. A light,
 * animated film grain over the glow gives it texture.
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
uniform float uTime;       // seconds, for the noise
uniform vec4 uNoise;       // per-run noise offset
uniform float uHead;       // main swell, 0-1 clockwise from the top centre
uniform float uEntry;      // where the light grows from, same units
uniform float uSpread;     // 0-1: how much of the outline is lit yet
uniform float uReveal;     // 0 (gone) to 1 (full light), eased
uniform vec4 uShape;       // swell length (fraction of a lap), reach px,
                           // intensity, floor (light between the swells)
uniform float uLevel;      // overall breathing
uniform vec3 uTint0;       // accent
uniform vec3 uTint1;       // warmer (hue toward amber/red)
uniform vec3 uTint2;       // cooler (hue toward green/blue)
uniform vec3 uHaze0;       // light theme: lighter, more saturated tints
uniform vec3 uHaze1;
uniform vec3 uHaze2;
uniform float uHazeOn;     // 0 for grey tints (Neutral)
uniform float uDark;       // 1 in dark mode

const float HALF_PI = 1.5707963;
const float PI = 3.1415927;
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

float fbm2(vec3 p) {
  float v = 0.65 * valueNoise(p);
  v += 0.35 * valueNoise(p * 2.07 + vec3(8.3, 2.8, 5.6));
  return v;
}

// Position along the outline of the point nearest p, 0-1 clockwise from the
// top centre (y down). Continuous everywhere outside the box: each point is
// projected onto the rounded outline, so straight edges and corners join
// without seams.
float outlinePosition(vec2 p, vec2 e, float r, float perimeter) {
  vec2 c = clamp(p, -e, e);
  vec2 v = p - c;
  if (dot(v, v) < 1e-6) {
    // Inside the inner rectangle: take the nearer side.
    v = uHalf.x - abs(p.x) < uHalf.y - abs(p.y)
      ? vec2(p.x >= 0.0 ? 1.0 : -1.0, 0.0)
      : vec2(0.0, p.y >= 0.0 ? 1.0 : -1.0);
  }
  float s;
  if (v.x >= 0.0 && v.y < 0.0) {
    // Top edge, right half, then the top-right corner.
    s = c.x + r * atan(v.x, -v.y);
  } else if (v.x > 0.0 && v.y >= 0.0) {
    s = e.x + HALF_PI * r + (c.y + e.y) + r * atan(v.y, v.x);
  } else if (v.x <= 0.0 && v.y > 0.0) {
    s = e.x + 2.0 * e.y + PI * r + (e.x - c.x) + r * atan(-v.x, v.y);
  } else {
    s = 3.0 * e.x + 2.0 * e.y + 1.5 * PI * r + (e.y - c.y)
      + r * atan(-v.y, -v.x);
  }
  return fract(s / perimeter);
}

// A swell centred on head: a long, soft tail behind it (counter-clockwise,
// so it leads clockwise) and a shorter soft front.
float swell(float u, float head, float len) {
  float behind = fract(head - u + 0.5) - 0.5;
  float x = behind / max(len, 1e-3);
  return behind >= 0.0 ? exp(-x * x * 1.6) : exp(-x * x * 6.0);
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uBuffer.y - gl_FragCoord.y) / uRatio;
  vec2 p = css - uCenter;
  float d = sdRoundBox(p, uHalf, uRadius);
  // The text box covers everything inside it.
  if (d < -2.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float r = uRadius;
  vec2 e = max(uHalf - r, 0.0);
  float perimeter = max(4.0 * (e.x + e.y) + TAU * r, 1.0);
  float u = outlinePosition(p, e, r, perimeter);
  // The room the light has in this direction, so it fades out before the
  // canvas edge and keeps the text box's rounded shape instead of filling
  // the canvas's square corners.
  vec2 out2 = p - clamp(p, -e, e);
  vec2 n = dot(out2, out2) > 1e-6 ? normalize(out2) : vec2(0.0, -1.0);
  float roomY = n.y < 0.0 ? uMargins.x : uMargins.z;
  float roomX = n.x > 0.0 ? uMargins.y : uMargins.w;
  float room = roomX * n.x * n.x + roomY * n.y * n.y;

  // Seamless noise round the loop that drifts clockwise with the swells.
  float a = TAU * (u - uHead);
  float loopR = perimeter / (TAU * 120.0);
  vec3 nc = vec3(cos(a) * loopR, sin(a) * loopR, 0.35 * uTime)
    + uNoise.xyz * 41.0;
  float nReach = fbm2(nc);
  float nBright = fbm2(nc * 1.6 + vec3(5.2, 1.3, 2.8 + uNoise.w));

  float len = uShape.x;
  float main = swell(u, uHead, len);
  float second = swell(u, fract(uHead + 0.5), len * 0.8);
  // Between the swells the light never goes out completely.
  float along = main + 0.55 * second;
  float lit = uShape.w + (1.0 - uShape.w) * clamp(along, 0.0, 1.0);

  // Entrance: the lit part of the outline opens out both ways from the
  // entry point until it closes round the whole text box.
  float fromEntry = abs(fract(u - uEntry + 0.5) - 0.5) * 2.0;
  float open = 1.0 - smoothstep(uSpread - 0.18, uSpread + 0.02, fromEntry);
  open = uSpread >= 1.0 ? 1.0 : open;

  // How far the light reaches here: wider at the swells, varied by noise.
  float reach = uShape.y * mix(0.25, 1.0, uReveal) * mix(0.4, 1.0, lit)
    * (0.5 + 1.0 * nReach);
  reach = clamp(reach, 2.0, max(room * 0.42, 2.0));
  float outd = max(d, 0.0);
  // A Gaussian body with a long, soft exponential skirt: no visible edge.
  float body = exp(-(outd * outd) / (2.0 * reach * reach));
  float skirt = exp(-outd / (1.8 * reach));
  float falloff = 0.6 * body + 0.4 * skirt;
  // Fade in over the last px under the text box's antialiased edge.
  falloff *= smoothstep(-2.0, 0.0, d);

  // The swells stand out: brightness rises faster than the reach.
  float bright = uShape.z * uReveal * (uShape.w + (1.0 - uShape.w) * pow(clamp(along,
    0.0, 1.0), 1.3) * 1.35) * (0.7 + 0.6 * nBright) * open;

  // Colour along the outline: warmer at the main swell's head, the accent
  // through its body, cooler toward its tail and the second swell.
  float head = swell(u, fract(uHead - len * 0.15), len * 0.45);
  vec3 w = vec3(0.55 + 0.45 * main, 0.8 * head, 0.25 + 0.6 * second
    + 0.35 * (1.0 - main));
  w /= (w.x + w.y + w.z);

  // Fade gently to nothing at the canvas edges, across whatever room there is.
  vec2 size = uBuffer / uRatio;
  float fade = smoothstep(0.0, 1.0, css.y / max(uMargins.x, 1.0))
    * smoothstep(0.0, 1.0, (size.x - css.x) / max(uMargins.y, 1.0))
    * smoothstep(0.0, 1.0, (size.y - css.y) / max(uMargins.z, 1.0))
    * smoothstep(0.0, 1.0, css.x / max(uMargins.w, 1.0));
  float energy = bright * falloff * uLevel * fade;

  // Film grain: a fresh per-pixel speckle about 24 times a second, scaled
  // by the light so the page around it stays clean.
  float frameNo = floor(uTime * 24.0);
  float grain = hash(vec3(floor(gl_FragCoord.xy), mod(frameNo, 997.0)))
    - 0.5;
  energy *= 1.0 + mix(0.45, 0.3, uDark) * grain;

  if (uDark > 0.5) {
    // Dark: additive light, tone-mapped and premultiplied so no channel
    // exceeds alpha; the main swell's head runs a little toward white.
    vec3 tint = uTint0 * w.x + uTint1 * w.y + uTint2 * w.z;
    tint = mix(tint, vec3(1.0), 0.25 * head * main);
    vec3 light = tint * energy * 1.35;
    float alpha = 1.0 - exp(-max(max(light.r, light.g), light.b) * 1.1);
    vec3 col = 1.0 - exp(-light);
    gl_FragColor = vec4(min(col, vec3(alpha)), alpha);
  } else {
    // Light: tints laid over a white page by coverage darken it, so the
    // light is a haze of lighter, more saturated tints whose coverage
    // follows its energy, capped so it never turns into a solid band.
    // Grey tints (Neutral) would read as a drop shadow: they get a much
    // fainter haze of the mid-grey tints.
    vec3 haze = uHaze0 * w.x + uHaze1 * w.y + uHaze2 * w.z;
    vec3 grey = uTint0 * w.x + uTint1 * w.y + uTint2 * w.z;
    vec3 tint = mix(grey, haze, uHazeOn);
    float cap = mix(0.2, 0.72, uHazeOn);
    float alpha = cap * (1.0 - exp(-energy * 2.2));
    gl_FragColor = vec4(tint * alpha, alpha);
  }
}
`;
