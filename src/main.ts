import { createApp } from "vue";
import { createPinia } from "pinia";
import TheMainPage from "./TheMainPage.vue";
import { installConsoleLogger } from "./services/logger";
import "./theme.css";

installConsoleLogger("main");
createApp(TheMainPage).use(createPinia()).mount("#main");
