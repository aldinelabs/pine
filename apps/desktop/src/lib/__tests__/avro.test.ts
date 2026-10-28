import { describe, expect, it } from "vitest";
import { openAvro } from "../avro";

function long(value: number): number[] {
  let n = BigInt(value);
  n = (n << 1n) ^ (n >> 63n);
  const out: number[] = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return out;
}

const text = (value: string) => {
  const bytes = [...new TextEncoder().encode(value)];
  return [...long(bytes.length), ...bytes];
};

function container(schema: object, blocks: number[][][], codec = "null") {
  const sync = Array.from({ length: 16 }, (_, index) => index);
  const header = [
    0x4f,
    0x62,
    0x6a,
    0x01,
    ...long(2),
    ...text("avro.schema"),
    ...text(JSON.stringify(schema)),
    ...text("avro.codec"),
    ...text(codec),
    ...long(0),
    ...sync,
  ];
  const body = blocks.flatMap((records) => {
    const data = records.flat();
    return [...long(records.length), ...long(data.length), ...data, ...sync];
  });
  return new Uint8Array([...header, ...body]).buffer;
}

const schema = {
  type: "record",
  name: "Row",
  fields: [
    { name: "id", type: "long" },
    { name: "name", type: ["null", "string"] },
    { name: "tags", type: { type: "array", items: "string" } },
    { name: "kind", type: { type: "enum", name: "Kind", symbols: ["a", "b"] } },
  ],
};

const row = (id: number, name: string | null, tags: string[], kind: number) => [
  ...long(id),
  ...(name === null ? long(0) : [...long(1), ...text(name)]),
  ...(tags.length ? [...long(tags.length), ...tags.flatMap(text)] : []),
  ...long(0),
  ...long(kind),
];

describe("openAvro", () => {
  it("indexes blocks and decodes the rows asked for", async () => {
    const file = openAvro(
      container(schema, [
        [row(1, "one", ["x", "y"], 0), row(2, null, [], 1)],
        [row(-3, "three", [], 0)],
      ]),
    );
    expect(file.rowCount).toBe(3);
    expect(file.columns).toEqual([
      { name: "id", type: "long" },
      { name: "name", type: "null | string" },
      { name: "tags", type: "array<string>" },
      { name: "kind", type: "Kind" },
    ]);
    expect(await file.rows(1, 3)).toEqual([
      [2, null, [], "b"],
      [-3, "three", [], "a"],
    ]);
    expect(await file.rows(0, 1)).toEqual([[1, "one", ["x", "y"], "a"]]);
  });

  it("rejects unsupported codecs and foreign files", () => {
    expect(() => openAvro(container(schema, [], "snappy"))).toThrow(/snappy/);
    expect(() => openAvro(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow();
  });
});
