use super::*;

/// Lowercases and folds Polish diacritics so "wiecej" and "więcej" compare equal.
pub(super) fn fold_semantic_text(value: &str) -> String {
    let mut folded = String::with_capacity(value.len());
    for character in value.to_lowercase().chars() {
        if ('\u{300}'..='\u{36f}').contains(&character) {
            continue;
        }
        if ('\u{ff01}'..='\u{ff5e}').contains(&character) {
            if let Some(ascii) = char::from_u32(character as u32 - 0xfee0) {
                folded.push(ascii);
                continue;
            }
        }
        folded.push(match character {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' | 'ǎ' | 'ǻ' => 'a',
            'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => 'c',
            'ď' | 'đ' => 'd',
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => 'e',
            'ĝ' | 'ğ' | 'ġ' | 'ģ' => 'g',
            'ĥ' | 'ħ' => 'h',
            'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ǐ' => 'i',
            'ĵ' => 'j',
            'ķ' => 'k',
            'ĺ' | 'ļ' | 'ľ' | 'ŀ' | 'ł' => 'l',
            'ñ' | 'ń' | 'ņ' | 'ň' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ō' | 'ŏ' | 'ő' | 'ơ' | 'ǒ' => 'o',
            'ŕ' | 'ŗ' | 'ř' => 'r',
            'ś' | 'ŝ' | 'ş' | 'š' => 's',
            'ţ' | 'ť' | 'ŧ' => 't',
            'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' | 'ư' | 'ǔ' => {
                'u'
            }
            'ŵ' => 'w',
            'ý' | 'ÿ' | 'ŷ' => 'y',
            'ź' | 'ż' | 'ž' => 'z',
            'ß' => {
                folded.push_str("ss");
                continue;
            }
            'ø' => {
                folded.push('o');
                continue;
            }
            'æ' => {
                folded.push_str("ae");
                continue;
            }
            'œ' => {
                folded.push_str("oe");
                continue;
            }
            other => other,
        });
    }
    folded
}

/// Function words, navigation chrome and date fragments. The list is shared
/// with the semantic map (src/services/semanticText.ts) and stored folded.
fn semantic_stopwords() -> &'static HashSet<String> {
    static STOPWORDS: OnceLock<HashSet<String>> = OnceLock::new();
    STOPWORDS.get_or_init(|| {
        let lists: HashMap<String, serde_json::Value> = serde_json::from_str(include_str!(
            "../../../../src/constants/semanticStopwords.json"
        ))
        .expect("bundled semantic stopword list is valid JSON");
        ["pl", "en"]
            .iter()
            .filter_map(|language| lists.get(*language)?.as_array())
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .map(fold_semantic_text)
            .collect()
    })
}

/// True for stopwords and tokens that are mostly digits ("2026", "100k").
/// Alphanumeric acronyms such as "b2b" or "2fa" stay topical.
pub(super) fn semantic_noise_token(folded: &str) -> bool {
    let letters = folded
        .chars()
        .filter(|character| character.is_alphabetic())
        .count();
    let digits = folded
        .chars()
        .filter(|character| character.is_numeric())
        .count();
    letters < 2 || digits >= letters || semantic_stopwords().contains(folded)
}

// Light inflection stripping, longest suffix first, on folded text. Mirrors
// `semanticTermKey` in src/services/semanticText.ts so crawler grouping and map
// clustering agree on which forms are the same word.
const POLISH_SEMANTIC_SUFFIXES: &[&str] = &[
    "iami", "iach", "ami", "ach", "iom", "iem", "ego", "emu", "ych", "ich", "ymi", "imi", "owi",
    "om", "ow", "em", "ie", "ia", "ii", "iu", "ym", "im", "ej", "a", "e", "i", "o", "u", "y",
];
const MIN_POLISH_STEM_CHARS: usize = 4;

/// Grouping key for inflected forms of one word. Internal only: extracted
/// terms keep a surface form observed on the page.
pub(super) fn semantic_term_key(term: &str, language: Option<&str>) -> String {
    let folded = fold_semantic_text(term);
    let char_count = folded.chars().count();
    match normalized_language(language)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("pl") => POLISH_SEMANTIC_SUFFIXES
            .iter()
            .find(|suffix| {
                folded.ends_with(*suffix) && char_count - suffix.len() >= MIN_POLISH_STEM_CHARS
            })
            .map(|suffix| folded[..folded.len() - suffix.len()].to_string())
            .unwrap_or(folded),
        Some("en") => {
            if char_count > 4 && folded.ends_with("ies") {
                format!("{}y", &folded[..folded.len() - 3])
            } else if char_count >= 5
                && folded.ends_with('s')
                && folded
                    .chars()
                    .rev()
                    .nth(1)
                    .is_some_and(|previous| !"aeiousy".contains(previous))
            {
                folded[..folded.len() - 1].to_string()
            } else {
                folded
            }
        }
        _ => folded,
    }
}
