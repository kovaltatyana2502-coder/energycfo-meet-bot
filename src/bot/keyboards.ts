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

