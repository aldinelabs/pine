/**
 * Data files previewed as one or more tables: databases, columnar files,
 * Avro containers and WebAssembly modules. Rows load in pages as the grid
 * scrolls, so large files only cost what is on screen.
 */
import type { GridCell } from "./dataGrid";

export interface DatasetColumn {
  name: string;
  type?: string;
}

export interface DatasetTable {
  name: string;
  /** What the table is, such as `view`, shown next to its name. */
  kind?: string;
  columns: DatasetColumn[];
  rowCount: number;
  rows: (start: number, end: number) => Promise<GridCell[][]>;
}

export interface Dataset {
  tables: DatasetTable[];
  close?: () => void;
}

export async function openSqlite(buffer: ArrayBuffer): Promise<Dataset> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import("sql.js"),
    import("sql.js/dist/sql-wasm.wasm?url"),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(new Uint8Array(buffer));
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
  try {
    const objects =
      db.exec(
        "select name, type from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%' order by type, name",
      )[0]?.values ?? [];
    const tables = objects.map(([name, type]): DatasetTable => {
      const table = String(name);
      const columns = (
        db.exec(`pragma table_info(${quote(table)})`)[0]?.values ?? []
      ).map(([, column, columnType]) => ({
        name: String(column),
        type: String(columnType ?? "") || undefined,
      }));
      const count = Number(
        db.exec(`select count(*) from ${quote(table)}`)[0]?.values[0]?.[0] ?? 0,
      );
      return {
        name: table,
        kind: type === "view" ? "view" : undefined,
        columns,
        rowCount: count,
        rows: (start, end) => {
          const result = db.exec(
            `select * from ${quote(table)} limit ? offset ?`,
            [end - start, start],
          )[0];
          return Promise.resolve(result?.values ?? []);
        },
      };
    });
    return { tables, close: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}

export async function openParquet(buffer: ArrayBuffer): Promise<Dataset> {
  const { parquetMetadata, parquetRead, parquetSchema } =
    await import("hyparquet");
  const metadata = parquetMetadata(buffer);
  const columns = parquetSchema(metadata).children.map((child) => {
    const element = child.element;
    const logical = element.logical_type?.type;
    return {
      name: element.name,
      type:
        logical ??
        element.converted_type ??
        element.type ??
        (child.children.length ? "GROUP" : undefined),
    };
  });
  return {
    tables: [
      {
        name: "parquet",
        columns,
        rowCount: Number(metadata.num_rows),
        rows: (start, end) =>
          new Promise((resolve, reject) => {
            parquetRead({
              file: buffer,
              metadata,
              rowStart: start,
              rowEnd: end,
              rowFormat: "array",
              onComplete: (rows) => resolve(rows as GridCell[][]),
            }).catch(reject);
          }),
      },
    ],
  };
}

export async function openAvroDataset(buffer: ArrayBuffer): Promise<Dataset> {
  const { openAvro } = await import("./avro");
  const file = openAvro(buffer);
  return {
    tables: [
      {
        name: "avro",
        columns: file.columns,
        rowCount: file.rowCount,
        rows: file.rows,
      },
    ],
  };
}

/** A module's imports and exports, as WebAssembly reports them. */
export async function openWasm(buffer: ArrayBuffer): Promise<Dataset> {
  const module = await WebAssembly.compile(buffer);
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);
  const custom = ["name", "producers", "target_features", "sourceMappingURL"]
    .map(
      (name) =>
        [name, WebAssembly.Module.customSections(module, name)] as const,
    )
    .filter(([, found]) => found.length);
  const table = (
    name: string,
    columns: DatasetColumn[],
    rows: GridCell[][],
  ): DatasetTable => ({
    name,
    columns,
    rowCount: rows.length,
    rows: (start, end) => Promise.resolve(rows.slice(start, end)),
  });
  return {
    tables: [
      table(
        "exports",
        [{ name: "name" }, { name: "kind" }],
        exports.map((item) => [item.name, item.kind]),
      ),
      table(
        "imports",
        [{ name: "module" }, { name: "name" }, { name: "kind" }],
        imports.map((item) => [item.module, item.name, item.kind]),
      ),
      ...(custom.length
        ? [
            table(
              "custom sections",
              [{ name: "name" }, { name: "bytes" }],
              custom.map(([name, found]) => [
                name,
                found.reduce((sum, section) => sum + section.byteLength, 0),
              ]),
            ),
          ]
        : []),
    ],
  };
}
