import { createApp } from "vue";
import TheChaoxingMaskPage from "./TheChaoxingMaskPage.vue";
import { installConsoleLogger } from "./services/logger";
import { listenForThemeColors } from "./theme";
import "./theme.css";

installConsoleLogger("chaoxing-mask");
void listenForThemeColors();
createApp(TheChaoxingMaskPage).mount("#chaoxing-mask");
