/**
 * Shows a 2D canvas brighter than SDR white on HDR displays: a WebGPU canvas
 * in extended tone mapping copies the source and multiplies its colour, and
 * the display's headroom renders the values above 1.
 *
 * TypeScript's DOM library has no WebGPU types and the project does not
 * depend on `@webgpu/types`, so only the calls used here are declared.
 */

interface GpuTexture {
  createView(): unknown;
  destroy(): void;
  width: number;
  height: number;
}

interface GpuDevice {
  createShaderModule(descriptor: { code: string }): unknown;
  createRenderPipeline(descriptor: unknown): {
    getBindGroupLayout(index: number): unknown;
  };
  createTexture(descriptor: {
    size: [number, number];
    format: string;
    usage: number;
  }): GpuTexture;
  createBuffer(descriptor: { size: number; usage: number }): unknown;
  createBindGroup(descriptor: unknown): unknown;
  createCommandEncoder(): {
    beginRenderPass(descriptor: unknown): {
      setPipeline(pipeline: unknown): void;
      setBindGroup(index: number, group: unknown): void;
      draw(vertexCount: number): void;
      end(): void;
    };
    finish(): unknown;
  };
  queue: {
    writeBuffer(buffer: unknown, offset: number, data: Float32Array): void;
    copyExternalImageToTexture(
      source: { source: HTMLCanvasElement; origin: [number, number] },
      destination: {
        texture: GpuTexture;
        origin: [number, number];
        premultipliedAlpha: boolean;
      },
      size: [number, number],
    ): void;
    submit(commands: unknown[]): void;
  };
  destroy(): void;
}

interface GpuCanvasContext {
  configure(configuration: unknown): void;
  getCurrentTexture(): GpuTexture;
}

interface Gpu {
  requestAdapter(): Promise<{ requestDevice(): Promise<GpuDevice> } | null>;
}

// GPUTextureUsage and GPUBufferUsage flags.
const TEXTURE_COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;
const TEXTURE_RENDER_ATTACHMENT = 0x10;
const BUFFER_COPY_DST = 0x08;
const BUFFER_UNIFORM = 0x40;

const SHADER = /* wgsl */ `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: vec4f;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corners = array(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let colour = textureLoad(source, vec2i(position.xy), 0);
  // The source is premultiplied, so scaling its colour keeps it that way.
  return vec4f(colour.rgb * params.x, colour.a);
}
`;

/** A region of the source, in device pixels. */
export interface HdrRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HdrOverlay {
  /** Shows `source`, its colour multiplied by `gain`. `region` bounds what
   * the source holds this time; only it and the last region are uploaded. */
  draw(source: HTMLCanvasElement, gain: number, region?: HdrRegion): void;
  clear(): void;
  destroy(): void;
}

/** Resolves to nothing when WebGPU, extended tone mapping or an HDR display
 * is missing, so callers keep their SDR rendering. */
export async function createHdrOverlay(
  canvas: HTMLCanvasElement,
): Promise<HdrOverlay | undefined> {
  const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu;
  if (!gpu || !window.matchMedia?.("(dynamic-range: high)").matches) return;

  let device: GpuDevice;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return;
    device = await adapter.requestDevice();
  } catch {
    return;
  }

  const context = canvas.getContext("webgpu") as GpuCanvasContext | null;
  if (!context) {
    device.destroy();
    return;
  }
  try {
    context.configure({
      device,
      format: "rgba16float",
      alphaMode: "premultiplied",
      toneMapping: { mode: "extended" },
    });
  } catch {
    device.destroy();
    return;
  }

  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba16float" }],
    },
  });
  const params = device.createBuffer({
    size: 16,
    usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
  });
  const gainData = new Float32Array(4);

  let texture: GpuTexture | undefined;
  let bindGroup: unknown;
  /** Where the texture last received content, which the next upload must
   * overwrite even if the source has moved on. */
  let uploaded: HdrRegion | undefined;

  function ensureTexture(width: number, height: number) {
    if (texture?.width === width && texture.height === height) return;
    texture?.destroy();
    uploaded = undefined;
    texture = device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_RENDER_ATTACHMENT,
    });
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: { buffer: params } },
      ],
    });
  }

  function render(withSource: boolean) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context!.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    if (withSource) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  return {
    draw(source, gain, region) {
      const { width, height } = source;
      if (!width || !height) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas.style.width = source.style.width;
      canvas.style.height = source.style.height;
      ensureTexture(width, height);
      gainData[0] = gain;
      device.queue.writeBuffer(params, 0, gainData);

      // Upload the union of this region and the last one, so stale texels
      // are overwritten by the source's cleared pixels.
      const whole = { left: 0, top: 0, right: width, bottom: height };
      const next = region ?? whole;
      const left = Math.max(
        0,
        Math.floor(Math.min(next.left, uploaded?.left ?? next.left)),
      );
      const top = Math.max(
        0,
        Math.floor(Math.min(next.top, uploaded?.top ?? next.top)),
      );
      const right = Math.min(
        width,
        Math.ceil(Math.max(next.right, uploaded?.right ?? next.right)),
      );
      const bottom = Math.min(
        height,
        Math.ceil(Math.max(next.bottom, uploaded?.bottom ?? next.bottom)),
      );
      if (right > left && bottom > top) {
        device.queue.copyExternalImageToTexture(
          { source, origin: [left, top] },
          { texture: texture!, origin: [left, top], premultipliedAlpha: true },
          [right - left, bottom - top],
        );
      }
      uploaded = region ? { ...region } : whole;
      render(true);
    },
    clear() {
      if (canvas.width && canvas.height) render(false);
    },
    destroy() {
      texture?.destroy();
      device.destroy();
    },
  };
}
