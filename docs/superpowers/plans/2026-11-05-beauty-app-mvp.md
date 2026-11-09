# Beauty App MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Веб-приложение для салона: запись визитов, закрытие дня, расчёт зарплаты 50/50, кабинет мастера со скрытыми контактами клиентов.

**Architecture:** Монолит Next.js (App Router, TypeScript) + PostgreSQL через Prisma. Вся бизнес-логика и проверки прав живут в `src/lib/services` и `src/lib/access`; страницы и API-маршруты только вызывают их. Контакты клиентов лежат в отдельной таблице, которую слой доступа мастера не читает.

**Tech Stack:** Next.js, TypeScript, Prisma, PostgreSQL (локально через Docker), Vitest, bcryptjs, jose.

**Spec:** `docs/superpowers/specs/2026-11-05-beauty-app-mvp-design.md`

## Этапы

- **Этап 1 (текущий): учёт оплат и расчёт зарплаты.** Task 1, 2, 3, 4; из Task 5 только `createClient` с именем (без телефона) и `searchClients` без контактов; Task 6 (без `masterVisit` и `masterVisits`); Task 8 без `masterEarnings`. Результат: администратор входит, добавляет мастеров, записывает визиты с суммой и способом оплаты, видит расчёт 50/50 за период, отмечает выплату и делает корректировки.
- **Этап 2: кабинет мастера и защита контактов.** Остаток Task 5 (телефоны, согласие, удаление), `masterVisits`, `masterVisit`, `masterEarnings`, Task 9.
- **Этап 3: закрытие дня и сверка с кассой.** Task 7.
- **Этап 4: демо-данные и подготовка к запуску.** Task 10.

Задачи внутри этапа выполняются по порядку; следующий этап начинается после вашего подтверждения.

## Global Constraints

- Доля мастера = 50% от суммы, которую клиент реально заплатил; процент хранится в таблице настроек (`Setting`, ключ `master_share_percent`).
- Доля мастера = `floor(amount * percent / 100)`; остаток остаётся салону.
- Деньги — только целые числа в тенге; дробные, нулевые и отрицательные суммы отклоняются.
- Периоды: 1–15 и 16–конец месяца; визит относится к периоду по своей дате визита.
- Часовой пояс бизнеса `Asia/Almaty`; даты визитов и закрытий хранятся как `DATE`, в коде это строки `YYYY-MM-DD`.
- Роли: `admin` и `master`; роль назначает только администратор.
- Мастер не создаёт и не правит визиты; не получает телефоны и контакты ни одним ответом сервера.
- Закрытие дня: ожидаемые наличные = сумма визитов дня со способом `cash`; повторное закрытие даты запрещено.
- После «Выплачено» визиты периода нельзя править напрямую; изменения только корректировкой с причиной.
- Только демо-данные до переноса на хостинг в Казахстане и юридической проверки.
- Вне MVP: каталог услуг, чаевые, сертификаты, Google Calendar, общий журнал изменений, ИИ, офлайн-режим.

## Review Focus

- Мастер запрашивает визит другого мастера по его `id`: ожидается отказ, не данные (Task 6).
- Телефон клиента просачивается через вложенный объект `client` в ответ мастеру: в JSON ответа не должно быть ни поля, ни значения телефона (Tasks 5, 11).
- Сумма приходит как `"15 000"`, `1.5`, `0`, `-5`, `1e12`: визит не сохраняется, понятная ошибка (Task 6).
- Границы периодов: 15/16 число, 28/29 февраля високосного года, 31-е, визит около полуночи по Алматы (Task 2).
- Деактивированный пользователь с ещё действующей cookie: запрос отклоняется (Task 3).

---

### Task 1: Каркас проекта и база данных

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `docker-compose.yml`, `.env.example`, `.gitignore`
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `tests/setup/db.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: `prisma: PrismaClient` (`src/lib/db.ts`); `resetDb(): Promise<void>` (`tests/setup/db.ts`, очищает все таблицы и заново вставляет настройку `master_share_percent=50`); модели Prisma `User(id, name, login, passwordHash, role, active)`, `Client(id, name, assignedMasterId)`, `ClientContact(clientId, phone, consentAt)`, `Visit(id, visitDate, masterId, clientId, amount, paymentMethod, createdById, createdAt)`, `VisitAdjustment(id, visitId, oldAmount, newAmount, reason, changedById, changedAt)`, `DayClosing(id, closingDate unique, expectedCash, actualCash, difference, closedById, closedAt, comment)`, `Payout(id, masterId, periodStart, periodEnd, calculatedAmount, adjustmentAmount, adjustmentReason, finalAmount, status, paidAt, paidById)` с уникальностью `(masterId, periodStart, periodEnd)`, `Setting(key, value)`.

- [ ] **Step 1: Создать проект** командой `npx create-next-app@latest . --ts --app --src-dir --no-tailwind --eslint --use-npm` и поставить зависимости `prisma @prisma/client bcryptjs jose` и dev-зависимости `vitest @types/bcryptjs`.
- [ ] **Step 2: Написать падающий тест** `tests/smoke.test.ts`: `resetDb()` затем `prisma.setting.findUnique({where:{key:"master_share_percent"}})` возвращает `value === "50"`.
- [ ] **Step 3: Запустить** `npx vitest run tests/smoke.test.ts`. Ожидается FAIL (нет схемы).
- [ ] **Step 4: Описать `prisma/schema.prisma`** по Interfaces (enum `Role{admin,master}`, `PaymentMethod{cash,transfer}`, `PayoutStatus{pending,paid}`; `visitDate`, `closingDate`, `periodStart`, `periodEnd` типа `@db.Date`; `amount` и суммы — `Int`), добавить `docker-compose.yml` с PostgreSQL (две базы: `beauty` для работы и `beauty_test` для тестов); в `Visit` поле `clientId` необязательное с `onDelete: SetNull`, `.env.example` с `DATABASE_URL`, `TEST_DATABASE_URL`, `SESSION_SECRET`; реализовать `src/lib/db.ts` и `resetDb`; выполнить `docker compose up -d` и `npx prisma migrate dev --name init`.
- [ ] **Step 5: Запустить** `npx vitest run tests/smoke.test.ts` (тесты используют `TEST_DATABASE_URL`). Ожидается PASS.
- [ ] **Step 6: Commit** `git add -A && git commit -m "chore: scaffold app and database schema"`

### Task 2: Деньги и периоды (чистые функции)

**Files:**
- Create: `src/lib/money.ts`, `src/lib/periods.ts`
- Test: `tests/money.test.ts`, `tests/periods.test.ts`

**Interfaces:**
- Produces: `masterShare(amount: number, percent: number): number`; `parseAmount(input: unknown): number` (бросает `AmountError` с русским сообщением); `periodFor(isoDate: string): { start: string; end: string }`; `todayInBusinessTz(now: Date): string`.

- [ ] **Step 1: Написать падающие тесты.** `masterShare(15001, 50) === 7500`, `masterShare(15000, 50) === 7500`, `masterShare(1, 50) === 0`. `parseAmount` принимает `15000` и `"15000"`; бросает `AmountError` для `"15 000"`, `1.5`, `0`, `-5`, `1e12`, `""`, `null`. `periodFor("2026-03-15")` → `{start:"2026-03-01", end:"2026-03-15"}`; `periodFor("2026-03-16")` → `{start:"2026-03-16", end:"2026-03-31"}`; `periodFor("2028-02-20").end === "2028-02-29"`; `periodFor("2026-02-20").end === "2026-02-28"`. `todayInBusinessTz(new Date("2026-03-15T19:30:00Z")) === "2026-03-16"` (23:30 в UTC даёт следующий день по Алматы, UTC+5).
- [ ] **Step 2: Запустить** `npx vitest run tests/money.test.ts tests/periods.test.ts`. Ожидается FAIL.
- [ ] **Step 3: Реализовать функции.** Верхний предел суммы `10_000_000`; Алматы — фиксированное смещение UTC+5 через `Intl.DateTimeFormat` с `timeZone: "Asia/Almaty"`.
- [ ] **Step 4: Запустить те же тесты.** Ожидается PASS.
- [ ] **Step 5: Commit** `git add src/lib tests && git commit -m "feat: money and period helpers"`

### Task 3: Вход, сессии, проверка роли

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/guard.ts`, `src/app/login/page.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`; `verifyPassword(plain: string, hash: string): Promise<boolean>`; `createSessionToken(userId: string): Promise<string>` (JWT, срок 7 суток, подпись `SESSION_SECRET`); `getCurrentUser(token: string | undefined): Promise<User | null>` (читает пользователя из БД на каждый вызов; `null` для неактивного, несуществующего, просроченного или подделанного токена); `requireRole(user: User | null, role: "admin" | "master"): User` (бросает `ForbiddenError`).
- Consumes: `prisma`, `resetDb` (Task 1).

- [ ] **Step 1: Написать падающие тесты.** Верный пароль проходит, неверный нет, в БД хеш не равен паролю. `getCurrentUser` возвращает пользователя для свежего токена; `null` для токена с изменённой подписью; `null` для токена пользователя с `active=false` (Review Focus); `null` для просроченного токена. `requireRole(masterUser, "admin")` бросает `ForbiddenError`; `requireRole(null, "master")` бросает.
- [ ] **Step 2: Запустить** `npx vitest run tests/auth.test.ts`. Ожидается FAIL.
- [ ] **Step 3: Реализовать** по Interfaces; cookie сессии `httpOnly`, `sameSite=lax`, `secure` в production; маршрут входа отвечает одинаковой ошибкой на неверный логин и неверный пароль.
- [ ] **Step 4: Запустить тесты.** Ожидается PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: login, sessions and role guard"`

### Task 4: Сотрудники (только администратор)

**Files:**
- Create: `src/lib/services/users.ts`, `src/app/admin/staff/page.tsx`
- Test: `tests/users.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `hashPassword` (Task 3).
- Produces: `createUser(actor: User, input: { name: string; login: string; password: string; role: Role }): Promise<User>`; `setUserActive(actor: User, userId: string, active: boolean): Promise<void>`; `listMasters(actor: User): Promise<{ id: string; name: string }[]>`.

- [ ] **Step 1: Написать падающие тесты.** Администратор создаёт мастера; мастер, вызвав `createUser`, получает `ForbiddenError`; повторный логин отклоняется; пароль короче 8 символов отклоняется; `listMasters` не возвращает администраторов и неактивных.
- [ ] **Step 2: Запустить** `npx vitest run tests/users.test.ts`. Ожидается FAIL.
- [ ] **Step 3: Реализовать** сервис; страница показывает список и форму добавления на телефоне.
- [ ] **Step 4: Запустить тесты.** Ожидается PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: staff management"`

### Task 5: Клиенты, контакты и слой доступа мастера

**Files:**
- Create: `src/lib/services/clients.ts`, `src/lib/access/master.ts`, `src/lib/access/admin.ts`, `src/app/admin/clients/page.tsx`
- Test: `tests/clients.test.ts`, `tests/access-master.test.ts`

**Interfaces:**
- Produces: `createClient(actor: User, input: { name: string; assignedMasterId: string; phone?: string }): Promise<{ id: string; name: string }>` (при телефоне записывает `ClientContact` с `consentAt = now`); `searchClients(actor: User, q: string): Promise<AdminClientDto[]>`; `updateClientContact(actor: User, clientId: string, phone: string): Promise<void>`; `deleteClient(actor: User, clientId: string): Promise<void>` (удаляет клиента и контакты; визиты остаются без привязки к имени: поле `clientName` не копируется, визит хранит `clientId` с `onDelete: SetNull`).
- Produces (мастер): `MasterClientDto = { id: string; name: string }`; `masterClients(actor: User): Promise<MasterClientDto[]>` — только закреплённые за актором; `src/lib/access/master.ts` не импортирует таблицу `ClientContact` и не обращается к `prisma.clientContact` (проверяется тестом).

- [ ] **Step 1: Написать падающие тесты.** Админ создаёт клиента с телефоном: телефон лежит в `client_contacts`, `consentAt` заполнен. `masterClients(masterA)` возвращает только клиентов masterA. `JSON.stringify(await masterClients(masterA))` не содержит телефона клиента ни как значение, ни как ключ `phone` (Review Focus). Тест читает исходник `src/lib/access/master.ts` и убеждается, что в нём нет строк `clientContact` и `phone`. `searchClients` вызванный мастером бросает `ForbiddenError`. `deleteClient` убирает контакты.
- [ ] **Step 2: Запустить** `npx vitest run tests/clients.test.ts tests/access-master.test.ts`. Ожидается FAIL.
- [ ] **Step 3: Реализовать** сервис и слой доступа; DTO формируются явными маппер-функциями, а не возвратом объектов Prisma.
- [ ] **Step 4: Запустить тесты.** Ожидается PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: clients with isolated contacts"`

### Task 6: Визиты

**Files:**
- Create: `src/lib/services/visits.ts`, `src/app/admin/visits/new/page.tsx`, `src/app/admin/page.tsx`
- Modify: `src/lib/access/master.ts`
- Test: `tests/visits.test.ts`

**Interfaces:**
- Consumes: `parseAmount`, `masterShare`, `periodFor` (Task 2); `requireRole` (Task 3); `Setting` (Task 1).
- Produces: `createVisit(actor: User, input: { visitDate: string; masterId: string; clientId: string; amount: unknown; paymentMethod: "cash" | "transfer"; confirmDuplicate?: boolean }): Promise<{ id: string }>` — при возможном дубле (тот же мастер, клиент и сумма, `createdAt` за последние 10 минут) бросает `DuplicateWarning`, если не передан `confirmDuplicate: true`; `listVisitsForDay(actor: User, isoDate: string): Promise<AdminVisitDto[]>`; `MasterVisitDto = { id: string; visitDate: string; clientName: string; amount: number; myShare: number }`; `masterVisits(actor: User, range: { start: string; end: string }): Promise<MasterVisitDto[]>`; `masterVisit(actor: User, visitId: string): Promise<MasterVisitDto>` (чужой визит: `NotFoundError`).

- [ ] **Step 1: Написать падающие тесты.** Админ создаёт визит; мастер, вызвав `createVisit`, получает `ForbiddenError`. Суммы `"15 000"`, `1.5`, `0`, `-5`, `1e12` не сохраняются (Review Focus). Дубль в пределах 10 минут бросает `DuplicateWarning`, с `confirmDuplicate: true` сохраняется. `masterVisits(masterA)` не содержит визитов masterB. `masterVisit(masterA, visitOfMasterB.id)` бросает `NotFoundError` (Review Focus). `myShare` для суммы 15001 равен 7500. Визит неактивному мастеру не создаётся.
- [ ] **Step 2: Запустить** `npx vitest run tests/visits.test.ts`. Ожидается FAIL.
- [ ] **Step 3: Реализовать** сервис и расширить `src/lib/access/master.ts`; страница нового визита: выбор мастера, поиск клиента с быстрым созданием, сумма, способ оплаты, одна кнопка; главная администратора показывает визиты дня и итог.
- [ ] **Step 4: Запустить тесты.** Ожидается PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: visits with master isolation"`

### Task 7: Закрытие дня

**Files:**
- Create: `src/lib/services/closing.ts`, `src/app/admin/closing/page.tsx`
- Test: `tests/closing.test.ts`

**Interfaces:**
- Consumes: `Visit` (Task 6), `requireRole`.
- Produces: `dayTotals(actor: User, isoDate: string): Promise<{ expectedCash: number; transferTotal: number }>`; `closeDay(actor: User, input: { closingDate: string; actualCash: number; comment?: string }): Promise<{ expectedCash: number; actualCash: number; difference: number }>` (`difference = actualCash − expectedCash`; повтор той же даты бросает `AlreadyClosedError`).

- [ ] **Step 1: Написать падающие тесты.** Три визита дня (cash 10 000, cash 5 000, transfer 7 000) дают `expectedCash = 15000`, `transferTotal = 7000`; при `actualCash = 14000` `difference = -1000`. День без визитов закрывается с `expectedCash = 0`. Повторное закрытие бросает `AlreadyClosedError`. Мастер получает `ForbiddenError`. Отрицательный `actualCash` отклоняется.
- [ ] **Step 2: Запустить** `npx vitest run tests/closing.test.ts`. Ожидается FAIL.
- [ ] **Step 3: Реализовать** сервис; страница подсвечивает ненулевое расхождение красным.
- [ ] **Step 4: Запустить тесты.** Ожидается PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: daily cash closing"`

### Task 8: Зарплата, выплаты и корректировки

**Files:**
- Create: `src/lib/services/payroll.ts`, `src/app/admin/payroll/page.tsx`
- Modify: `src/lib/services/visits.ts`, `src/lib/access/master.ts`
- Test: `tests/payroll.test.ts`

**Interfaces:**
- Consumes: `masterShare`, `periodFor` (Task 2); `Visit`, `VisitAdjustment`, `Payout` (Tasks 1, 6).
- Produces: `computePayroll(actor: User, period: { start: string; end: string }): Promise<PayrollLine[]>` где `PayrollLine = { masterId: string; masterName: string; visitCount: number; revenue: number; calculated: number; adjustment: number; adjustmentReason: string | null; final: number; status: "pending" | "paid" }` (для выплаченного периода значения берутся из `Payout`, для открытого вычисляются из визитов); `markPaid(actor: User, masterId: string, period): Promise<void>` (фиксирует снимок в `Payout`, статус `paid`); `adjustPayout(actor: User, masterId: string, period, adjustment: number, reason: string): Promise<void>` (причина обязательна; `final = calculated + adjustment`; допустима и для выплаченного периода, значение `final` обновляется, причина сохраняется); `adjustVisitAmount(actor: User, visitId: string, newAmount: unknown, reason: string): Promise<void>` (пишет `VisitAdjustment`; для визита в выплаченном периоде бросает `PeriodPaidError`); `masterEarnings(actor: User, period): Promise<{ calculated: number; final: number; status: "pending" | "paid" }>`.

- [ ] **Step 1: Написать падающие тесты.** Демо-случай: мастер с визитами 100 000 и 80 000 даёт `revenue = 180000`, `calculated = 90000`. Визит 16 числа не попадает в период 1–15. `markPaid` фиксирует снимок, после чего `adjustVisitAmount` по визиту этого периода бросает `PeriodPaidError`; новый визит за тот же период не меняет выплаченную сумму в `computePayroll`. `adjustPayout` без причины отклоняется. `adjustVisitAmount` в открытом периоде пересчитывает долю и сохраняет старое и новое значение. Мастер получает `ForbiddenError` на `computePayroll` и `markPaid`; `masterEarnings(masterA, period)` учитывает только его визиты.
- [ ] **Step 2: Запустить** `npx vitest run tests/payroll.test.ts`. Ожидается FAIL.
- [ ] **Step 3: Реализовать** сервис; страница: переключатель периода (1–15 / 16–конец), строки мастеров, кнопки «Выплачено» и «Корректировка» с обязательной причиной.
- [ ] **Step 4: Запустить тесты.** Ожидается PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: payroll, payouts and adjustments"`

### Task 9: Кабинет мастера и API-защита

**Files:**
- Create: `src/app/master/page.tsx`, `src/app/master/earnings/page.tsx`, `src/app/api/master/visits/route.ts`, `src/app/api/master/visits/[id]/route.ts`, `src/app/api/master/earnings/route.ts`, `src/middleware.ts`
- Test: `tests/api-permissions.test.ts`

**Interfaces:**
- Consumes: `masterVisits`, `masterVisit`, `masterEarnings` (Tasks 6, 8); `getCurrentUser`, `requireRole` (Task 3).
- Produces: маршруты `GET /api/master/visits?start&end`, `GET /api/master/visits/:id`, `GET /api/master/earnings?start&end`; middleware перенаправляет без сессии на `/login` и разводит `/admin/*` (только admin) и `/master/*` (только master).

- [ ] **Step 1: Написать падающие тесты** на уровне вызова обработчиков маршрутов с cookie сессии. Мастер A запрашивает `/api/master/visits/:idВизитаМастераB` и получает 404; без cookie получает 401; телефон клиента (подготовленный в тесте) не встречается ни в одном ответе мастерских маршрутов (проверка `JSON.stringify` и `includes(phone)`); мастер, открыв страницу `/admin/*` (middleware), получает перенаправление, а администратор не имеет доступа к `/master/*`; мастерские маршруты `/api/master/*` с cookie администратора возвращают 403.
- [ ] **Step 2: Запустить** `npx vitest run tests/api-permissions.test.ts`. Ожидается FAIL.
- [ ] **Step 3: Реализовать** маршруты как тонкие обёртки над сервисами и страницы мастера: «Мои визиты» (сумма и заработок по каждому визиту) и «Мой заработок» (период, статус выплаты), без контактов.
- [ ] **Step 4: Запустить весь набор** `npx vitest run`. Ожидается PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: master cabinet and API permission tests"`

### Task 10: Демо-данные, резервные копии, ввод в эксплуатацию

**Files:**
- Create: `prisma/seed.ts`, `docs/operations.md`
- Modify: `package.json` (скрипт `seed`)

**Interfaces:**
- Consumes: сервисы Tasks 4–8.
- Produces: `npm run seed` создаёт администратора, 8 мастеров, 20 выдуманных клиентов и визиты за два периода с заведомыми числами из спецификации (мастер A: 180 000 ₸ выручки, 90 000 ₸ к выплате).

- [ ] **Step 1: Написать `prisma/seed.ts`.** Телефоны только вымышленные формата `+7 700 000 00 NN`.
- [ ] **Step 2: Запустить** `npm run seed`, затем `npm run dev` и вручную пройти путь: вход администратором, новый визит, закрытие дня, экран «Зарплата» (мастер A показывает 90 000), вход мастером (контактов нет нигде).
- [ ] **Step 3: Написать `docs/operations.md`:** чек-лист перед реальными данными: хостинг в Казахстане, ежедневные автоматические бэкапы и проверка восстановления, смена `SESSION_SECRET`, HTTPS, юридическая проверка по законодательству Республики Казахстан, согласие клиентов.
- [ ] **Step 4: Запустить** `npx vitest run`. Ожидается PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "chore: demo seed and operations checklist"`
