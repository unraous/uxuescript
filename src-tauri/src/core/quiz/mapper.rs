use std::collections::HashMap;
use std::sync::LazyLock;

use ttf_parser::Face;

use super::html::{HtmlExtractPayload, Question};
use super::typr::{glyph_hash, loca_offsets};

static FONT_HASH_TABLE: LazyLock<HashMap<String, u32>> = LazyLock::new(|| {
    let raw: HashMap<String, serde_json::Value> =
        serde_json::from_slice(include_bytes!("table.json")).expect("内置字体哈希字典格式无效");
    raw.into_iter()
        .filter_map(|(hash, value)| Some((hash, value.as_u64()? as u32)))
        .collect()
});

fn font_map(font_data: &[u8]) -> HashMap<char, char> {
    let face = match Face::parse(font_data, 0) {
        Ok(face) => face,
        Err(_) => return HashMap::new(),
    };
    let cmap = match face.tables().cmap {
        Some(cmap) => cmap,
        None => return HashMap::new(),
    };
    let offsets = match loca_offsets(font_data) {
        Some(offsets) => offsets,
        None => return HashMap::new(),
    };

    let num_glyphs = face.number_of_glyphs();
    let mut glyph_to_char = HashMap::with_capacity(num_glyphs as usize);
    for subtable in cmap.subtables {
        subtable.codepoints(|codepoint| {
            if let Some(gid) = subtable.glyph_index(codepoint) {
                if let Some(ch) = char::from_u32(codepoint) {
                    glyph_to_char.entry(gid.0).or_insert(ch);
                }
            }
        });
    }

    let mut map = HashMap::new();
    for glyph_id in 0..num_glyphs {
        let Some(&original) = glyph_to_char.get(&glyph_id) else {
            continue;
        };
        let Some(hash) = glyph_hash(font_data, &offsets, glyph_id as usize) else {
            continue;
        };
        let Some(&codepoint) = FONT_HASH_TABLE.get(&hash) else {
            continue;
        };
        if let Some(real) = char::from_u32(codepoint) {
            map.insert(original, real);
        }
    }

    log::debug!("哈希字典匹配到 {} 个字形", map.len());
    map
}

fn map(text: &str, font_map: &HashMap<char, char>) -> String {
    text.chars()
        .map(|c| font_map.get(&c).cloned().unwrap_or(c))
        .collect()
}

pub fn decrypt(payload: HtmlExtractPayload) -> Vec<Question> {
    if let Some(font_data) = payload.font {
        log::info!("检测到加密字体，正在使用哈希字典解密...");
        let font_map = font_map(&font_data);
        payload
            .questions
            .into_iter()
            .map(|q| Question {
                id: map(&q.id, &font_map),
                kind: map(&q.kind, &font_map),
                stem: map(&q.stem, &font_map),
                options: q
                    .options
                    .into_iter()
                    .map(|opt| map(&opt, &font_map))
                    .collect(),
            })
            .collect()
    } else {
        log::info!("未检测到加密字体，跳过解密步骤");
        payload.questions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::quiz::html;
    use serde_json::to_value;
    use std::collections::HashMap;

    #[test]
    fn test_map_basic() {
        let mut font_map = HashMap::new();
        font_map.insert('a', 'x');
        font_map.insert('b', 'y');
        let out = map("abc", &font_map);
        assert_eq!(out, "xyc");
    }

    #[test]
    fn test_map_unmapped_chars_unchanged() {
        let font_map = HashMap::new();
        let out = map("héllo", &font_map);
        assert_eq!(out, "héllo");
    }

    #[test]
    fn test_decrypt_no_font_returns_same_questions() {
        let q1 = Question {
            id: "1".into(),
            kind: "single".into(),
            stem: "What is 1+1?".into(),
            options: vec!["A. 1".into(), "B. 2".into()],
        };
        let q2 = Question {
            id: "2".into(),
            kind: "multi".into(),
            stem: "Choose colors".into(),
            options: vec!["Red".into(), "Blue".into()],
        };

        let questions = vec![q1.clone(), q2.clone()];
        let payload = HtmlExtractPayload {
            questions: questions.clone(),
            font: None,
        };
        let decrypted = decrypt(payload);

        let expected = to_value(&questions).expect("serialize expected failed");
        let actual = to_value(&decrypted).expect("serialize actual failed");
        assert_eq!(expected, actual);
    }

    #[test]
    fn test_decrypt_flow() {
        let compressed = include_bytes!("../../../tests/assets/course-page/webpage.html.gz");
        let html = html::load_test_html(compressed);
        let raw = HtmlExtractPayload::new(&html).expect("Failed to parse HTML");
        let start = std::time::Instant::now();
        let decrypted = decrypt(raw);
        println!("🚀 字体哈希解密耗时: {:?}", start.elapsed());
        for question in &decrypted {
            println!("解密后题目：{:?}", question);
        }

        let f = std::fs::File::create("tests/assets/course-page/decrypted.json")
            .expect("create output file failed");
        serde_json::to_writer_pretty(f, &decrypted).expect("write decrypted json failed");
    }
}
