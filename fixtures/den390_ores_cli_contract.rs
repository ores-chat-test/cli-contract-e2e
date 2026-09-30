use std::fs;
use std::path::PathBuf;

use flags2env::BundledFlags2Env;

const CONTRACT: &str = r#"
[env]
files = []

[parse]
command_env = "TEST_COMMAND"
positionals_env = "TEST_POSITIONALS"
unknown_options_env = "TEST_UNKNOWN_OPTIONS"
errors_env = "TEST_PARSE_ERRORS"
allow_unknown = false

[flags.json]
env = "TEST_JSON"
aliases = ["json"]
type = "bool"
default = "true"
true_aliases = ["t", "1", "yes"]
false_aliases = ["f", "0", "no"]

[flags.colors]
env = "TEST_COLORS"
aliases = ["colors"]
type = "bool"
default = "true"
true_aliases = ["t", "1", "yes"]
false_aliases = ["f", "0", "no"]

[commands.org]
env = "TEST_COMMAND_ORG"

[commands.org.flags.name]
env = "TEST_ORG_NAME"
aliases = ["name", "org", "owner"]
short = "n"
type = "string"

[commands.org.flags.family-prefix]
env = "TEST_ORG_FAMILY_PREFIX"
aliases = ["family-prefix", "prefix", "prefix-family"]
type = "string"

[commands.org.commands.list-missing-repos]
env = "TEST_COMMAND_ORG_LIST_MISSING_REPOS"

[commands.org.commands.list-missing-repos.flags.report]
env = "TEST_ORG_LIST_REPORT"
aliases = ["report"]
type = "bool"
default = "false"
"#;

fn argv(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn contract_file() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "den390-flags2env-{}-{}.toml",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    fs::write(&path, CONTRACT).expect("write fixture contract");
    path
}

#[test]
fn contract_audits_and_prefix_alias_resolves() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();
    parser.audit_config(Some(path_str)).expect("fixture audit");

    let args = argv(&[
        "oresc",
        "org",
        "--name=litegraph",
        "--prefix=ltgr",
        "list-missing-repos",
    ]);
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("structured parse");
    assert!(structured.unknown_options.is_empty());
    assert!(structured.errors.is_empty());
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_ORG_NAME")
            .map(String::as_str),
        Some("litegraph")
    );
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_ORG_FAMILY_PREFIX")
            .map(String::as_str),
        Some("ltgr")
    );
    let commands = parser
        .resolve_commands(&args, Some(path_str))
        .expect("command resolution");
    assert_eq!(
        commands.path,
        vec!["org".to_owned(), "list-missing-repos".to_owned()]
    );
    let _ = fs::remove_file(path);
}

#[test]
fn typo_and_arbitrary_unknown_options_fail_closed() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();

    for unknown in ["--preix=ltgr", "--definitely-not-real=opaque-value"] {
        let args = argv(&[
            "oresc",
            "org",
            "--name=litegraph",
            unknown,
            "list-missing-repos",
        ]);
        let structured = parser
            .parse_structured(&args, Some(path_str))
            .expect("structured parse");
        assert_eq!(structured.unknown_options.len(), 1, "{unknown}");
        assert!(structured.errors.is_empty(), "{unknown}");
    }
    let _ = fs::remove_file(path);
}

#[test]
fn typed_boolean_forms_and_negation_are_canonical() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();

    let args = argv(&[
        "oresc",
        "--json=yes",
        "--colors=false",
        "org",
        "--name=litegraph",
        "list-missing-repos",
    ]);
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("typed boolean parse");
    assert!(structured.unknown_options.is_empty());
    assert!(structured.errors.is_empty());
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_JSON")
            .map(String::as_str),
        Some("true")
    );
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_COLORS")
            .map(String::as_str),
        Some("false")
    );

    let negated = argv(&[
        "oresc",
        "--no-colors",
        "org",
        "--name=litegraph",
        "list-missing-repos",
    ]);
    let structured = parser
        .parse_structured(&negated, Some(path_str))
        .expect("negated boolean parse");
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_COLORS")
            .map(String::as_str),
        Some("false")
    );
    let _ = fs::remove_file(path);
}

#[test]
fn separate_values_and_short_alias_preserve_command_resolution() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();
    let args = argv(&[
        "oresc",
        "org",
        "-n",
        "litegraph",
        "--prefix",
        "ltgr",
        "list-missing-repos",
    ]);
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("separate-value parse");
    assert!(structured.unknown_options.is_empty());
    assert!(structured.errors.is_empty());
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_ORG_NAME")
            .map(String::as_str),
        Some("litegraph")
    );
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_ORG_FAMILY_PREFIX")
            .map(String::as_str),
        Some("ltgr")
    );
    let commands = parser
        .resolve_commands(&args, Some(path_str))
        .expect("command resolution");
    assert_eq!(
        commands.path,
        vec!["org".to_owned(), "list-missing-repos".to_owned()]
    );
    let _ = fs::remove_file(path);
}

#[test]
fn unknown_separate_value_fails_closed_before_nested_command_resolution() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();
    let args = argv(&[
        "oresc",
        "org",
        "--name",
        "litegraph",
        "--preix",
        "ltgr",
        "list-missing-repos",
    ]);
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("unknown separate-value parse");
    assert_eq!(structured.unknown_options.len(), 1);
    assert!(structured.unknown_options[0].starts_with("--preix"));
    let commands = parser
        .resolve_commands(&args, Some(path_str))
        .expect("command resolution");
    assert_eq!(commands.path, vec!["org".to_owned()]);
    let _ = fs::remove_file(path);
}

#[test]
fn terminator_keeps_flag_like_operands_out_of_unknown_options() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();
    let args = argv(&[
        "oresc",
        "org",
        "--name=litegraph",
        "list-missing-repos",
        "--",
        "--literal-not-a-flag",
    ]);
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("terminator parse");
    assert!(structured.unknown_options.is_empty());
    let _ = fs::remove_file(path);
}

#[test]
fn malformed_boolean_fails_closed_without_becoming_an_unknown_option() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();
    let args = argv(&[
        "oresc",
        "--colors=maybe",
        "org",
        "--name=litegraph",
        "list-missing-repos",
    ]);
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("malformed boolean parse");
    assert!(structured.unknown_options.is_empty());
    assert!(!structured.errors.is_empty());
    let _ = fs::remove_file(path);
}

#[test]
fn option_shaped_token_after_string_flag_is_reparsed_as_option() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();
    let args = argv(&["oresc", "org", "--name", "--json", "list-missing-repos"]);
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("option-shaped token parse");
    assert!(structured.unknown_options.is_empty());
    assert!(structured.errors.is_empty());
    assert!(!structured.provided_flags.contains_key("TEST_ORG_NAME"));
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_JSON")
            .map(String::as_str),
        Some("true")
    );
    let commands = parser
        .resolve_commands(&args, Some(path_str))
        .expect("command resolution");
    assert_eq!(
        commands.path,
        vec!["org".to_owned(), "list-missing-repos".to_owned()]
    );
    let _ = fs::remove_file(path);
}

#[test]
fn unknown_option_shaped_token_after_string_flag_is_not_consumed_as_value() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();
    let args = argv(&[
        "oresc",
        "org",
        "--name",
        "--literal-value",
        "list-missing-repos",
    ]);
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("unknown option-shaped token parse");
    assert_eq!(structured.unknown_options.len(), 1);
    assert!(structured.unknown_options[0].starts_with("--literal-value"));
    assert!(!structured.provided_flags.contains_key("TEST_ORG_NAME"));
    let _ = fs::remove_file(path);
}

#[test]
fn terminator_keeps_boolean_looking_operand_out_of_provided_flags() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();
    let args = argv(&[
        "oresc",
        "org",
        "--name=litegraph",
        "list-missing-repos",
        "--",
        "--json",
    ]);
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("terminator boolean-looking operand parse");
    assert!(structured.unknown_options.is_empty());
    assert!(!structured.provided_flags.contains_key("TEST_JSON"));
    let _ = fs::remove_file(path);
}

#[test]
fn malformed_boolean_error_does_not_reflect_supplied_value() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();
    let marker = "DO_NOT_REFLECT_7F4C9A";
    let malformed = format!("--colors={marker}");
    let args = vec![
        "oresc".to_owned(),
        malformed,
        "org".to_owned(),
        "--name=litegraph".to_owned(),
        "list-missing-repos".to_owned(),
    ];
    let structured = parser
        .parse_structured(&args, Some(path_str))
        .expect("malformed boolean parse");
    assert!(!structured.errors.is_empty());
    let rendered = structured.errors.join("\n");
    assert!(
        !rendered.contains(marker),
        "parser error reflected supplied value"
    );
    let _ = fs::remove_file(path);
}

#[test]
fn duplicate_boolean_occurrences_use_last_explicit_value() {
    let path = contract_file();
    let path_str = path.to_str().expect("UTF-8 path");
    let parser = BundledFlags2Env::new();

    let enable_last = argv(&[
        "oresc",
        "--json=false",
        "--json",
        "org",
        "--name=litegraph",
        "list-missing-repos",
    ]);
    let structured = parser
        .parse_structured(&enable_last, Some(path_str))
        .expect("duplicate boolean parse");
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_JSON")
            .map(String::as_str),
        Some("true")
    );

    let disable_last = argv(&[
        "oresc",
        "--json",
        "--json=false",
        "org",
        "--name=litegraph",
        "list-missing-repos",
    ]);
    let structured = parser
        .parse_structured(&disable_last, Some(path_str))
        .expect("duplicate boolean parse");
    assert_eq!(
        structured
            .provided_flags
            .get("TEST_JSON")
            .map(String::as_str),
        Some("false")
    );
    let _ = fs::remove_file(path);
}
