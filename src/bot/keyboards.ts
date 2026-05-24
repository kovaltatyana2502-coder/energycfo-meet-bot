import { Markup } from "telegraf";

const toRows = (items: string[], rowSize: number) => {
  const rows: string[][] = [];

  for (let index = 0; index < items.length; index += rowSize) {
    rows.push(items.slice(index, index + rowSize));
  }

  return rows;
};

export const mainMenuKeyboard = (isAdmin: boolean) => {
  const rows = [["Назначить встречу"], ["Мои встречи", "Помощь"]];

  if (isAdmin) {
    rows.push(["Админ-панель"]);
  }

  return Markup.keyboard(rows).resize();
};

export const adminMenuKeyboard = () =>
  Markup.keyboard([
    ["Новые заявки", "Заявки на перенос"],
    ["Активные встречи", "Недоступные даты"],
    ["Настройки расписания", "Статистика"],
    ["Назад"]
  ]).resize();

export const consentKeyboard = () => Markup.keyboard([["Согласен и продолжить"], ["Не согласен"]]).resize();

export const topicKeyboard = () =>
  Markup.keyboard([["Корпоративные функции", "Тарифная кампания"], ["Комплексный подход", "Другое"], ["Отменить"]]).resize();

export const contactChannelKeyboard = () =>
  Markup.keyboard([["Telegram", "Email"], ["Телефон", "WhatsApp"], ["Другое"], ["Отменить"]]).resize();

export const dateSelectionKeyboard = (
  dateLabels: string[],
  options: { hasPreviousPage: boolean; hasNextPage: boolean }
) => {
  const rows = toRows(dateLabels, 2);
  const navigationRow: string[] = [];

  if (options.hasPreviousPage) {
    navigationRow.push("Предыдущие даты");
  }

  if (options.hasNextPage) {
    navigationRow.push("Показать еще даты");
  }

  if (navigationRow.length > 0) {
    rows.push(navigationRow);
  }

  rows.push(["Отменить"]);

  return Markup.keyboard(rows).resize();
};

export const slotSelectionKeyboard = (slotLabels: string[]) =>
  Markup.keyboard([...toRows(slotLabels, 3), ["Выбрать другую дату"], ["Отменить"]]).resize();

export const bookingConfirmationKeyboard = () =>
  Markup.keyboard([["Отправить заявку"], ["Выбрать другое время"], ["Отменить"]]).resize();
