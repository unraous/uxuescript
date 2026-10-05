import { createApp } from "vue";
import TheMaskPage from "./TheMaskPage.vue";
import { installConsoleLogger } from "./services/logger";
import { listenForThemeColors } from "./theme";
import "./theme.css";

installConsoleLogger("mask");
void listenForThemeColors();
createApp(TheMaskPage).mount("#mask");
