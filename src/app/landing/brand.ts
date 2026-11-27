/**
 * Бренд главной: имя продукта, логотип и подпись студии. Ребрендинг FrogFlow →
 * Enveriq идёт по частям: пока только главная `/` говорит «Enveriq», ниши и
 * статьи остаются FrogFlow. Сменить логотип — заменить файлы в
 * `public/brand/` (или пути ниже); имя в текстах главной подставляется отсюда.
 * Домен остаётся frogflow.tech (`SITE_URL` в `./config`).
 */
export const BRAND = {
  /** Имя продукта в тексте. В логотипе — капителью ENVERIQ (решение Якова 08.11.2026). */
  name: "Enveriq",
  /**
   * Надпись-логотип, вариант S3 из /mnt/project-files/design/enveriq (выбор
   * временный): тёмные буквы для светлого фона и светлые — для тёмного.
   */
  logo: { src: "/brand/enveriq-logo.svg", width: 272, height: 67 },
  logoOnDark: { src: "/brand/enveriq-logo-on-dark.svg", width: 272, height: 67 },
  /** Квадратный знак (аватар, маленькие места). */
  mark: { src: "/brand/enveriq-mark.svg", width: 64, height: 64 },
  /** Подпись под логотипом: одинаковая на всех языках. */
  byline: "A FrogFlow Studio product",
  studioUrl: "https://frogflow-studio.tech",
  /** Картинка превью ссылки на главную, 1200×630. */
  ogImage: "/og-enveriq.png",
} as const;
