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

/** Период уже выплачен: прямое изменение визитов запрещено. */
export class PeriodPaidError extends Error {
  constructor(message = "Период уже выплачен. Используйте корректировку выплаты с указанием причины.") {
    super(message);
    this.name = "PeriodPaidError";
  }
}

/** День закрыт: финансовые данные зафиксированы, изменения только после повторного открытия дня. */
export class DayClosedError extends Error {
  constructor(message = "День закрыт. Чтобы изменить данные, администратор должен открыть день заново с указанием причины.") {
    super(message);
    this.name = "DayClosedError";
  }
}
