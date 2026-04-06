declare module 'better-sqlite3' {
  namespace BetterSqlite3 {
    interface Statement {
      all(...params: unknown[]): unknown[]
      get(...params: unknown[]): unknown
    }

    interface Database {
      prepare(sql: string): Statement
    }
  }

  const Database: {
    new (
      path: string,
      options?: {
        readonly?: boolean
        fileMustExist?: boolean
      },
    ): BetterSqlite3.Database
  }

  export = Database
}
