/** 超星课程及题目处理使用的 DOM 与 URL 选择器。 */
const workExam = {
  form: "#submitForm",
  question: ".questionLi.singleQuesId",
  number: ".mark_name",
  kind: ".colorShallow",
  title: ".mark_name",
  titleMeta: ".colorShallow",
  optionLabel: "span[data]",
  choice: {
    options: ".stem_answer .answerBg",
    text: ".answer_p",
    single: ".stem_answer span.num_option",
    multiple: ".stem_answer span.num_option_dx",
  },
  clearSelectedClass: ".stem_answer span:is(.check_answer, .check_answer_dx)",
  textInputs: ".stem_answer textarea, .stem_answer input[type='text']",
  blanks: ".stem_answer .Answer",
  fontStyles: "style",
  folio: {
    section: ".type_tit",
    titleEnd: ".clear, input, .stem_answer, .readComprehensionQues",
    // 阅读题结构已验证作业样本；考试暂沿用，待材料题样本确认。
    reading: ".readComprehensionQues",
    items: ":scope > .reading_answer",
    item: {
      number: ".reader_answer_tit",
      kind: ".read_type",
      title: ".reader_answer_tit",
      titleMeta: ".read_type",
      choice: {
        options: ".stem_answer > .hoverDiv",
        text: ".answer_p",
      },
    },
  },
  matching: {
    groups: [
      ".stem_answer .line_wid_half.fl .lineCt",
      ".stem_answer .line_wid_half.fr .lineCt",
    ],
    text: ".wid350",
    row: /** @param {string} value */ (value) =>
      `.line_answer_ct[index="${value}"]`,
    option: /** @param {string} value */ (value) =>
      `.options li[data="${value}"] a`,
    dropdown: ".selectBox > p",
  },
};

export const SELECTORS = {
  workExam,
  context: { title: ".mark_title", courseId: "input#courseId" },
  examPreview: {
    ...workExam,
    question: ".questionLi",
    number: ":scope > h3",
    title: ":scope > h3",
  },
  courseTree: {
    nodeClass: "div.posCatalog_select",
    nameClass: "span.posCatalog_name",
    titleSelector: ":has(span.posCatalog_title)",
    unfinishedSelector: ":has(.orangeNew)",
  },
  chapter: { tabClass: "div.prev_white" },
  video: {
    tag: "video",
    launchBtnClass: ".vjs-big-play-button",
    timelineClass: ".ans-timelineobjects",
    annotationContinueClass: ".ans-videoannotation .continueLearn",
    quizClass: ".ans-videoquiz",
    quizItemClass: ".tkItem",
    quizTitleClass: ".tkItem_title",
    quizOptionClass: ".ans-videoquiz-opt",
    quizSubmitId: "#videoquiz-submit",
    quizContinueId: "#videoquiz-continue",
  },
  audio: {
    tag: "#audio audio.vjs-tech",
    launchBtnClass: "#audio .vjs-play-control",
  },
  pdf: { iframeId: "#panView" },
  quiz: {
    question: "div.singleQuesId",
    number: ".Zy_TItle > i.fl",
    kind: ".newZy_TItle",
    title: ".fontLabel",
    titleMeta: ".colorShallow",
    optionLabel: "span[data]",
    choice: {
      options: ".Zy_ulTop > li",
      text: ".after",
      single: "span.num_option",
      multiple: "span.num_option_dx",
    },
    titleClass: ".newZy_TItle",
    clearSelectedClass: "span:is(.check_answer, .check_answer_dx)",
    textInputs: 'textarea[id^="answer"], textarea',
    blanks: ".blankItemDiv",
    // 暂保留既有结构规则；当前 Quiz 样本只有普通题，分区及材料题待验证。
    folio: {
      section: ".type_tit",
      titleEnd: ".clear, input, .stem_answer, .readComprehensionQues",
      reading: ".readComprehensionQues",
      items: ":scope > .reading_answer",
      item: {
        number: ".reader_answer_tit",
        kind: ".read_type",
        title: ".reader_answer_tit",
        titleMeta: ".read_type",
        choice: {
          options: ".stem_answer > .hoverDiv",
          text: ".answer_p",
        },
      },
    },
    ueditorIframe: 'iframe[id^="ueditor_"]',
    frameContentId: "#frame_content",
    btnSubmitClass: "a.btnSubmit",
    reeditBtnClass: "a.jb_btn_bg[onclick*='reediter']",
    modalId: "#workpop",
    modalOkBtnId: "a#popok",
  },
  taskPoint: {
    finishedClass: "ans-job-finished",
    containerSelector: ".ans-attach-ct:has(.ans-job-icon)",
    attachmentSelector: ".ans-attach-ct:has(iframe)",
    iframeTag: "iframe",
  },
  frames: {
    blankUrl: "about:blank",
    chapterFrameId: "#iframe",
  },
  urls: {
    video: "/ananas/modules/video/",
    audio: "/ananas/modules/audio/",
    pdf: "/ananas/modules/pdf/",
    quiz: "/ananas/modules/work/",
  },
};
