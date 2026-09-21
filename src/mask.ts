import { createApp } from "vue";
import TheMaskPage from "./TheMaskPage.vue";
import { installConsoleLogger } from "./services/logger";

installConsoleLogger("mask");
createApp(TheMaskPage).mount("#mask");
