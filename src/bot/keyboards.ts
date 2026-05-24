import { Markup } from "telegraf";

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
