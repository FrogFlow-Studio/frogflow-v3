import type { SectionDict } from "../section";

/** Мастер подключения Instagram и WhatsApp (channels/zernio/wizard): шаги и что делать при сбое. */
export const ru = {
  "wizard.title": "Подключение {channel} по шагам",
  "wizard.intro":
    "Войдите в аккаунт, мы проверим связь и дождёмся вашего тестового сообщения. Если на шаге что-то не так, здесь будет написано, что делать.",
  "wizard.step.login": "1. Войдите в аккаунт",
  "wizard.step.webhook": "2. Проверка связи",
  "wizard.step.test": "3. Тестовое сообщение",
  "wizard.step.done": "Готово",
  "wizard.hint.login":
    "Нажмите «Войти»: откроется страница Zernio, войдите в {channel} и разрешите доступ. Потом вы вернётесь сюда.",
  "wizard.hint.webhook":
    "Проверяем, что сообщения из {channel} доходят до магазина. Нажмите «Проверить» через минуту.",
  "wizard.hint.test":
    "Напишите любое сообщение в {channel} магазина с другого аккаунта или номера и нажмите «Проверить». Мы ничего не отправляем, а ждём ваше сообщение.",
  "wizard.hint.done": "{channel} подключён: тестовое сообщение дошло до магазина.",
  "wizard.start": "Войти в {channel}",
  "wizard.check": "Проверить",
  "wizard.ownerOnly": "Подключает владелец магазина.",
  "wizard.problem.not_configured":
    "Подключение каналов на платформе ещё не настроено. Мы уже видим, что вы здесь, и скоро включим его, повторять ничего не нужно.",
  "wizard.problem.conflict":
    "Этот аккаунт уже подключён к другому магазину. Войдите другим аккаунтом или напишите нам: освободим прежнее подключение.",
  "wizard.problem.expired":
    "Вход слетел (сменили пароль или отозвали доступ). Нажмите «Войти» и разрешите доступ заново.",
  "wizard.problem.unsure":
    "Не уверены, дошёл ли запрос до Zernio. Сначала нажмите «Проверить»: повтор «Войти» после этого не создаст второго подключения.",
  "wizard.problem.try_later":
    "Zernio сейчас занят или недоступен, запрос не прошёл. Подождите несколько минут и повторите.",
  "wizard.problem.refused":
    "Zernio отказал в подключении, повтор не поможет. Напишите нам: оператор уже видит, на каком шаге вы остановились.",
  "wizard.problem.webhook_off":
    "Связь платформы с вашим аккаунтом ещё не включена. Оператор видит, что вы ждёте, и включит её; ничего нажимать не нужно, потом нажмите «Проверить».",
  "wizard.problem.webhook_error":
    "Не удалось проверить связь. Нажмите «Проверить» через минуту, а если повторится, напишите нам.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "wizard.title": "{channel} арнасын қадамдап қосу",
  "wizard.intro":
    "Аккаунтқа кіріңіз, біз байланысты тексеріп, сіздің сынақ хабарламаңызды күтеміз. Қадамда бір нәрсе дұрыс болмаса, не істеу керегі осы жерде жазылады.",
  "wizard.step.login": "1. Аккаунтқа кіріңіз",
  "wizard.step.webhook": "2. Байланысты тексеру",
  "wizard.step.test": "3. Сынақ хабарлама",
  "wizard.step.done": "Дайын",
  "wizard.hint.login":
    "«Кіру» түймесін басыңыз: Zernio беті ашылады, {channel} аккаунтына кіріп, рұқсат беріңіз. Содан кейін осында ораласыз.",
  "wizard.hint.webhook":
    "{channel} хабарламалары дүкенге жетіп жатқанын тексеріп жатырмыз. Бір минуттан кейін «Тексеру» түймесін басыңыз.",
  "wizard.hint.test":
    "Дүкеннің {channel} арнасына басқа аккаунттан немесе нөмірден кез келген хабарлама жазып, «Тексеру» түймесін басыңыз. Біз ештеңе жібермейміз, сіздің хабарламаңызды күтеміз.",
  "wizard.hint.done": "{channel} қосылды: сынақ хабарлама дүкенге жетті.",
  "wizard.start": "{channel} арнасына кіру",
  "wizard.check": "Тексеру",
  "wizard.ownerOnly": "Қосуды дүкен иесі жасайды.",
  "wizard.problem.not_configured":
    "Платформада арналарды қосу әлі бапталмаған. Сіздің осында екеніңізді көріп тұрмыз, жақында қосамыз, ештеңені қайталаудың керегі жоқ.",
  "wizard.problem.conflict":
    "Бұл аккаунт басқа дүкенге қосылып қойған. Басқа аккаунтпен кіріңіз немесе бізге жазыңыз: бұрынғы байланысты босатамыз.",
  "wizard.problem.expired":
    "Кіру күші жойылды (құпиясөз ауыстырылған немесе рұқсат қайтарылған). «Кіру» түймесін басып, рұқсатты қайта беріңіз.",
  "wizard.problem.unsure":
    "Сұраныс Zernio-ға жеткені белгісіз. Алдымен «Тексеру» түймесін басыңыз: содан кейін «Кіру» қайталануы екінші байланыс жасамайды.",
  "wizard.problem.try_later":
    "Zernio қазір бос емес немесе қолжетімсіз, сұраныс өтпеді. Бірнеше минут күтіп, қайталаңыз.",
  "wizard.problem.refused":
    "Zernio қосудан бас тартты, қайталау көмектеспейді. Бізге жазыңыз: оператор сіздің қай қадамда тоқтағаныңызды көріп тұр.",
  "wizard.problem.webhook_off":
    "Платформаның аккаунтыңызбен байланысы әлі қосылмаған. Оператор сіздің күтіп тұрғаныңызды көріп, қосады; ештеңе басудың керегі жоқ, содан кейін «Тексеру» түймесін басыңыз.",
  "wizard.problem.webhook_error":
    "Байланысты тексеру мүмкін болмады. Бір минуттан кейін «Тексеру» түймесін басыңыз, қайталанса, бізге жазыңыз.",
};

export const en: SectionDict<typeof ru> = {
  "wizard.title": "Connect {channel} step by step",
  "wizard.intro":
    "Sign in to the account, we check the connection and wait for your test message. If a step goes wrong, this card says what to do.",
  "wizard.step.login": "1. Sign in",
  "wizard.step.webhook": "2. Connection check",
  "wizard.step.test": "3. Test message",
  "wizard.step.done": "Done",
  "wizard.hint.login":
    "Press “Sign in”: the Zernio page opens, sign in to {channel} and allow access. Then you come back here.",
  "wizard.hint.webhook":
    "We are checking that messages from {channel} reach the shop. Press “Check” in a minute.",
  "wizard.hint.test":
    "Send any message to the shop’s {channel} from another account or number, then press “Check”. We send nothing; we wait for your message.",
  "wizard.hint.done": "{channel} is connected: the test message reached the shop.",
  "wizard.start": "Sign in to {channel}",
  "wizard.check": "Check",
  "wizard.ownerOnly": "The shop owner connects the channel.",
  "wizard.problem.not_configured":
    "Channel connection is not set up on the platform yet. We can see you are here and will switch it on soon; there is nothing to repeat.",
  "wizard.problem.conflict":
    "This account is already connected to another shop. Sign in with a different account or write to us and we will free the old connection.",
  "wizard.problem.expired":
    "The sign-in has expired (the password changed or access was revoked). Press “Sign in” and allow access again.",
  "wizard.problem.unsure":
    "We are not sure the request reached Zernio. Press “Check” first: pressing “Sign in” after that will not create a second connection.",
  "wizard.problem.try_later":
    "Zernio is busy or unavailable and the request did not go through. Wait a few minutes and try again.",
  "wizard.problem.refused":
    "Zernio refused the connection and a retry will not help. Write to us: the operator can already see which step you stopped at.",
  "wizard.problem.webhook_off":
    "The platform’s link to your account is not switched on yet. The operator can see you are waiting and will switch it on; press nothing, then press “Check”.",
  "wizard.problem.webhook_error":
    "We could not check the connection. Press “Check” in a minute, and if it repeats, write to us.",
};

export const uz: SectionDict<typeof ru> = {
  "wizard.title": "{channel} kanalini bosqichma-bosqich ulash",
  "wizard.intro":
    "Akkauntga kiring, biz aloqani tekshirib, sizning sinov xabaringizni kutamiz. Bosqichda nimadir xato ketsa, bu yerda nima qilish kerakligi yoziladi.",
  "wizard.step.login": "1. Akkauntga kiring",
  "wizard.step.webhook": "2. Aloqani tekshirish",
  "wizard.step.test": "3. Sinov xabari",
  "wizard.step.done": "Tayyor",
  "wizard.hint.login":
    "«Kirish» tugmasini bosing: Zernio sahifasi ochiladi, {channel} akkauntiga kirib, ruxsat bering. Keyin shu yerga qaytasiz.",
  "wizard.hint.webhook":
    "{channel} xabarlari doʻkonga yetib borayotganini tekshiryapmiz. Bir daqiqadan soʻng «Tekshirish» tugmasini bosing.",
  "wizard.hint.test":
    "Doʻkonning {channel} kanaliga boshqa akkaunt yoki raqamdan istalgan xabar yozing va «Tekshirish» tugmasini bosing. Biz hech narsa yubormaymiz, sizning xabaringizni kutamiz.",
  "wizard.hint.done": "{channel} ulandi: sinov xabari doʻkonga yetib keldi.",
  "wizard.start": "{channel} kanaliga kirish",
  "wizard.check": "Tekshirish",
  "wizard.ownerOnly": "Kanalni doʻkon egasi ulaydi.",
  "wizard.problem.not_configured":
    "Platformada kanallarni ulash hali sozlanmagan. Siz shu yerda ekaningizni koʻryapmiz va tez orada yoqamiz, hech narsani takrorlash shart emas.",
  "wizard.problem.conflict":
    "Bu akkaunt allaqachon boshqa doʻkonga ulangan. Boshqa akkaunt bilan kiring yoki bizga yozing: avvalgi ulanishni boʻshatamiz.",
  "wizard.problem.expired":
    "Kirish bekor boʻlgan (parol almashtirilgan yoki ruxsat qaytarib olingan). «Kirish» tugmasini bosib, ruxsatni qaytadan bering.",
  "wizard.problem.unsure":
    "Soʻrov Zernio’ga yetib borgani nomaʼlum. Avval «Tekshirish» tugmasini bosing: shundan keyin «Kirish»ni takrorlash ikkinchi ulanish yaratmaydi.",
  "wizard.problem.try_later":
    "Zernio hozir band yoki ishlamayapti, soʻrov oʻtmadi. Bir necha daqiqa kutib, qayta urinib koʻring.",
  "wizard.problem.refused":
    "Zernio ulanishni rad etdi, takrorlash yordam bermaydi. Bizga yozing: operator qaysi bosqichda toʻxtaganingizni koʻryapti.",
  "wizard.problem.webhook_off":
    "Platformaning akkauntingiz bilan aloqasi hali yoqilmagan. Operator sizning kutayotganingizni koʻrib, yoqadi; hech narsa bosish shart emas, keyin «Tekshirish» tugmasini bosing.",
  "wizard.problem.webhook_error":
    "Aloqani tekshirib boʻlmadi. Bir daqiqadan soʻng «Tekshirish» tugmasini bosing, takrorlansa, bizga yozing.",
};
