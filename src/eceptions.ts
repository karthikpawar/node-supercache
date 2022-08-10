


export class InternalException extends Error {
    message: string
    code: string = 'internal_exception'
    name: string = 'InternalException'
    HTTP_Status: number = 500
    constructor(message: string){
        super(message)
        this.message = message
    }
}

export class EventPollTimeout extends InternalException {
    constructor(message: string){
        super(message)
        this.name = 'EventPollTimeout'
        this.code = 'poll_timeout'
        this.message = message
    }
}
