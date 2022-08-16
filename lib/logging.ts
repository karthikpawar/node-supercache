

export type GeneralLog = {
    debug(...args: any[]): any,
    info(...args: any[]): any,
    error(...args: any[]): any
}

export interface Logger_I {
    prefix: string,
    log : GeneralLog,
    mode?: string,
    alert?: any,
}


export class Logger implements Logger_I{
    mode: string
    prefix: string
    constructor(prefix: string, mode: string = 'DEBUG'){
        this.prefix = prefix
        this.mode = mode
    }

    log: GeneralLog = {
        debug: (...args: any[]) => {
            if(this.mode === 'DEBUG'){
                console.log(`${this.prefix}:`, ...args)
            }

            // implement custom log for production use case
        },
        info: (...args: any[]) => {
            console.log(`${this.prefix}:`, ...args)
            // implement custom log for production use case
        },
        error: (...args: any[]) => {
            console.log(`${this.prefix}:`, ...args)
            // implement custom log for production use case
        }
    }
}
