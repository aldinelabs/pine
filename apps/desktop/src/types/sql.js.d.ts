declare module "sql.js" {
  export type SqlValue = number | string | Uint8Array | null;
  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }
  export interface Database {
    exec(sql: string, params?: SqlValue[]): QueryExecResult[];
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
