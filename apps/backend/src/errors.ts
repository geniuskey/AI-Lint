/** 라우트 밖에서 상태코드를 결정해야 할 때 쓴다. 에러 핸들러가 그대로 매핑한다. */
export class HttpError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
  }
}
