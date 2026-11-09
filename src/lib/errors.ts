export class ForbiddenError extends Error {
  constructor(message = "Недостаточно прав") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Не найдено") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Возможный дубль визита: нужно явное подтверждение. */
export class DuplicateWarning extends Error {
  constructor(message = "Похоже, такой визит уже записан. Подтвердите, если это другой визит.") {
    super(message);
    this.name = "DuplicateWarning";
  }
}
