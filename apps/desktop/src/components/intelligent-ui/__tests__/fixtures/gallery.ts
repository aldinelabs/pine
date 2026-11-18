/** One block that draws every Intelligent UI component, for tests and review. */
export const galleryBlock = `root = Stack([head, layout, text, media, inputs, form, data, play])
$tab = "Week"
$plan = "pro"
$size = "M"
$level = 40
$day = "2026-11-20"
$left = 90
$name = ""
$email = ""
$agree = false
$done = false
head = Row([Icon("sparkles", "lg", "purple"), Heading("Component gallery", 1, "xl"), Spacer(), Badge("New", null, "success", "star")])
layout = Grid([boxA, boxB, card], 3, 180)
boxA = Box([Label("Box"), Caption("Muted fill with padding")], "md", "muted")
boxB = Box([Label("Bordered"), Caption("Outlined tile", "success")], "md", "none", true)
card = Card([Text("Soft card body")], "Soft card", "A filled panel", "soft")
text = Card([rich, Quote("Simplicity is the ultimate sophistication.", "Leonardo"), Code("const answer = 42;", "ts"), Math("E = mc^2"), more, acc, Popover("What is a term?", [Text("A definition shown on demand.")]), list, timeline], "Text")
rich = Text([Icon("clock", "sm"), " 25 min · ", Badge("Easy", null, "info"), " · ", Link("Docs", "https://example.com"), " · ", Math("a^2 + b^2", true)], "default", "md", "normal", true)
more = Text("Struck and clamped text that goes on for a while to show maxLines in action.", "muted", "sm", "medium", false, true, 1)
acc = Accordion([AccordionItem("First section", [Text("Hidden until opened.")]), AccordionItem("Second section", [Text("More detail.")])])
list = List(["Plain one", ListItem("Rich item", "With a description", "🍎")], false)
timeline = List([ListItem("Kickoff", "Agree on scope", "09:00"), ListItem("Review", "Walk through the draft", "13:00"), ListItem("Ship", null, "17:00")], false, true)
media = Card([Carousel([Image("https://example.com/a.jpg", "A photo", 1.5), Flashcard("Capital of France?", "Paris", "Geography"), Flashcard("2 + 2", "4")], 200)], "Media")
inputs = Card([Row([Button("Primary"), Button("Danger", @ToAssistant("Delete it"), "default", false, "danger", "sm", "trash"), Button("Soft", null, "soft", false, "success"), IconButton("settings", @ToAssistant("Open settings"), "Settings")], "sm", "center", "start", true), Pressable([Label("Pressable tile")], @Set($done, true), $done), SegmentedControl($tab, ["Day", "Week"]), RadioGroup($size, ["S", "M", "L"], "Size", "pills"), RadioGroup($plan, [{value: "free", label: "Free", description: "For trying it out"}, {value: "pro", label: "Pro", description: "For daily work"}], "Plan", "cards"), Slider($level, 0, 100, 10, "Level", "%", [{value: 0, label: "Off"}, {value: 100, label: "Max"}]), DatePicker($day, "Day", "2026-11-01", "2026-12-31"), Timer($left, "Break")], "Inputs")
form = Form([Input($name, "Name", "Your name", "text", {required: true}), Input($email, "Email", "you@example.com", "text", {required: true, email: true}), Checkbox($agree, "I agree", null, {required: true}), Select($size, ["S", "M", {value: "L", label: "Large"}], "Size"), Button("Submit", @ToAssistant("Here are my details"))])
data = Card([Table(["Item", "Status", "Count"], [["Alpha", Badge("Ready", null, "success"), 12], ["Beta", Badge("Blocked", null, "danger"), 3]]), Chart("pie", [{part: "A", value: 3}, {part: "B", value: 5}], null, null, null, false, "percent"), Chart("bar", [{month: "Jan", a: 3, b: 2}, {month: "Feb", a: 5, b: 4}], null, null, null, true, null, 160), Chart("scatter", [{h: 160, w: 55}, {h: 175, w: 70}]), Steps([Step("Install", "Download the app"), Step("Sign in"), Step("Connect a model")], 2)], "Data")
play = Stack([Text($done ? "Done!" : "Press the tile"), Celebration($done)])`;
