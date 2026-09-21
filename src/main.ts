import { createApp } from "vue";
import { createPinia } from "pinia";
import TheMainPage from "./TheMainPage.vue";
import { installConsoleLogger } from "./services/logger";

installConsoleLogger("main");
createApp(TheMainPage).use(createPinia()).mount("#main");
