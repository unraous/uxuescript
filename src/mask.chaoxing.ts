import { createApp } from "vue";
import TheChaoxingMaskPage from "./TheChaoxingMaskPage.vue";
import { installConsoleLogger } from "./services/logger";

installConsoleLogger("chaoxing-mask");
createApp(TheChaoxingMaskPage).mount("#chaoxing-mask");
