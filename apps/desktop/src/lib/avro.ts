/**
 * Reads Avro object container files. The header and block index are read up
 * front; a block's records are decoded only when rows inside it are asked for.
 * Supports the `null` and `deflate` codecs.
 */

type Schema =
  | string
  | Schema[]
  | {
      type: string | Schema | Schema[];
      name?: string;
      namespace?: string;
      fields?: { name: string; type: Schema }[];
      symbols?: string[];
      items?: Schema;
      values?: Schema;
      size?: number;
      logicalType?: string;
      scale?: number;
    };

class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}

  long(): number {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (this.offset >= this.bytes.length)
        throw new Error("The Avro data ends inside a number.");
      const byte = this.bytes[this.offset++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) break;
      shift += 7n;
      if (shift > 70n) throw new Error("The Avro data has an invalid number.");
    }
    const value = (result >> 1n) ^ -(result & 1n);
    return Number(value);
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length)
      throw new Error("The Avro data is truncated.");
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  bytesValue(): Uint8Array {
    return this.take(this.long());
  }

  string(): string {
    return decoder.decode(this.bytesValue());
  }
}

const decoder = new TextDecoder();
const MAGIC = [0x4f, 0x62, 0x6a, 0x01];

/** Named types defined so far, for references by name. */
type Names = Map<string, Schema>;

function register(schema: Schema, names: Names, namespace = ""): void {
  if (typeof schema === "string") return;
  if (Array.isArray(schema)) {
    for (const branch of schema) register(branch, names, namespace);
    return;
  }
  const space = schema.namespace ?? namespace;
  if (schema.name) {
    const full = schema.name.includes(".")
      ? schema.name
      : space
        ? `${space}.${schema.name}`
        : schema.name;
    names.set(full, schema);
    names.set(schema.name, schema);
  }
  if (typeof schema.type === "object") register(schema.type, names, space);
  for (const field of schema.fields ?? []) register(field.type, names, space);
  if (schema.items) register(schema.items, names, space);
  if (schema.values) register(schema.values, names, space);
}

function decode(reader: Reader, schema: Schema, names: Names): unknown {
  if (Array.isArray(schema)) {
    const branch = schema[reader.long()];
    if (branch === undefined)
      throw new Error("The Avro union index is invalid.");
    return decode(reader, branch, names);
  }
  if (typeof schema === "string") {
    switch (schema) {
      case "null":
        return null;
      case "boolean":
        return reader.take(1)[0] !== 0;
      case "int":
      case "long":
        return reader.long();
      case "float": {
        const bytes = reader.take(4);
        return new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(
          0,
          true,
        );
      }
      case "double": {
        const bytes = reader.take(8);
        return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(
          0,
          true,
        );
      }
      case "bytes":
        return reader.bytesValue();
      case "string":
        return reader.string();
      default: {
        const named = names.get(schema);
        if (!named) throw new Error(`The Avro type ${schema} is unknown.`);
        return decode(reader, named, names);
      }
    }
  }
  const type = schema.type;
  if (typeof type !== "string") return decode(reader, type, names);
  switch (type) {
    case "record":
    case "error":
      return Object.fromEntries(
        (schema.fields ?? []).map((field) => [
          field.name,
          decode(reader, field.type, names),
        ]),
      );
    case "enum":
      return schema.symbols?.[reader.long()] ?? null;
    case "array":
    case "map": {
      const items: unknown[] = [];
      const entries: Record<string, unknown> = {};
      for (;;) {
        let count = reader.long();
        if (count === 0) break;
        if (count < 0) {
          count = -count;
          reader.long(); // block size in bytes
        }
        for (let item = 0; item < count; item++) {
          if (type === "array")
            items.push(decode(reader, schema.items ?? "null", names));
          else
            entries[reader.string()] = decode(
              reader,
              schema.values ?? "null",
              names,
            );
        }
      }
      return type === "array" ? items : entries;
    }
    case "fixed":
      return reader.take(schema.size ?? 0);
    default:
      // A primitive written as {"type": "long", "logicalType": …}.
      return decode(reader, type, names);
  }
}

interface Block {
  count: number;
  data: Uint8Array;
  /** Index of the block's first record in the file. */
  first: number;
}

export interface AvroFile {
  schema: Schema;
  /** Top-level record fields, or a single `value` column otherwise. */
  columns: { name: string; type: string }[];
  rowCount: number;
  rows: (start: number, end: number) => Promise<unknown[][]>;
}

function typeName(schema: Schema): string {
  if (typeof schema === "string") return schema;
  if (Array.isArray(schema)) return schema.map(typeName).join(" | ");
  if (schema.logicalType) return schema.logicalType;
  if (typeof schema.type === "string")
    return schema.type === "array"
      ? `array<${typeName(schema.items ?? "null")}>`
      : schema.type === "map"
        ? `map<${typeName(schema.values ?? "null")}>`
        : (schema.name ?? schema.type);
  return typeName(schema.type);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function openAvro(buffer: ArrayBuffer): AvroFile {
  const reader = new Reader(new Uint8Array(buffer));
  if (!MAGIC.every((byte, index) => reader.bytes[index] === byte))
    throw new Error("Not an Avro object container file.");
  reader.offset = 4;
  const metadata = decode(
    reader,
    { type: "map", values: "bytes" },
    new Map(),
  ) as Record<string, Uint8Array>;
  const schemaBytes = metadata["avro.schema"];
  if (!schemaBytes) throw new Error("The Avro file has no schema.");
  const schema = JSON.parse(decoder.decode(schemaBytes)) as Schema;
  const codec = metadata["avro.codec"]
    ? decoder.decode(metadata["avro.codec"])
    : "null";
  if (codec !== "null" && codec !== "deflate")
    throw new Error(`The Avro codec ${codec} is not supported.`);
  const sync = reader.take(16);
  const names: Names = new Map();
  register(schema, names);

  const blocks: Block[] = [];
  let rowCount = 0;
  while (reader.offset < reader.bytes.length) {
    const count = reader.long();
    const data = reader.take(reader.long());
    const marker = reader.take(16);
    if (!marker.every((byte, index) => byte === sync[index]))
      throw new Error("The Avro block sync marker does not match.");
    blocks.push({ count, data, first: rowCount });
    rowCount += count;
  }

  const record =
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    schema.type === "record"
      ? schema
      : undefined;
  const columns = record?.fields?.map((field) => ({
    name: field.name,
    type: typeName(field.type),
  })) ?? [{ name: "value", type: typeName(schema) }];

  /** Recently decoded blocks; scrolling usually stays within a few. */
  const cache = new Map<Block, unknown[]>();
  async function records(block: Block): Promise<unknown[]> {
    const cached = cache.get(block);
    if (cached) return cached;
    const data = codec === "deflate" ? await inflate(block.data) : block.data;
    const blockReader = new Reader(data);
    const values = Array.from({ length: block.count }, () =>
      decode(blockReader, schema, names),
    );
    cache.set(block, values);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return values;
  }

  return {
    schema,
    columns,
    rowCount,
    async rows(start, end) {
      const result: unknown[][] = [];
      for (const block of blocks) {
        if (block.first + block.count <= start || block.first >= end) continue;
        const values = await records(block);
        for (
          let index = Math.max(start, block.first);
          index < Math.min(end, block.first + block.count);
          index++
        ) {
          const value = values[index - block.first];
          result.push(
            record
              ? columns.map(
                  (column) => (value as Record<string, unknown>)[column.name],
                )
              : [value],
          );
        }
      }
      return result;
    },
  };
}
