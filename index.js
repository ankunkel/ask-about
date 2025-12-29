const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// In-memory storage (replace with DB for production)
const kudos = {};
const domains = {};   // key: domainName
const badges = {};    // key: userId -> array of badges
const expertise = {}; // key: userId -> array of domains
const questions = {}; // key: questionId -> question object

// Utility to post messages to Slack webhook
async function postToSlack(blocks) {
  await axios.post(SLACK_WEBHOOK_URL, { blocks });
}

// ================== Slash Commands ==================
app.post("/slack/commands", async (req, res) => {
  const { command, text, user_id, trigger_id } = req.body;
  res.send(""); // immediate response (<3s required)

  // -------- /kudos --------
  if (command === "/kudos") {
    kudos[user_id] = (kudos[user_id] || 0) + 5;

    await axios.post(SLACK_WEBHOOK_URL, {
      text: `:tada: Kudos to <@${user_id}>!\n========\nWhy: ${text}\nPoints: 5\nTotal: ${kudos[user_id]} :star2:`
    });
  }

  // -------- /domain --------
  if (command === "/domain") {
    await axios.post("https://slack.com/api/views.open", {
      trigger_id,
      view: {
        type: "modal",
        callback_id: "domain_modal",
        title: { type: "plain_text", text: "Manage Domains" },
        submit: { type: "plain_text", text: "Save" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "domain_select_block",
            element: {
              type: "external_select",
              action_id: "domain_select",
              placeholder: { type: "plain_text", text: "Select a domain" },
              min_query_length: 0
            },
            label: { type: "plain_text", text: "Choose existing domain" }
          },
          {
            type: "input",
            block_id: "domain_text_block",
            element: { type: "plain_text_input", action_id: "domain_text", placeholder: { type: "plain_text", text: "Or add a new domain" } },
            optional: true,
            label: { type: "plain_text", text: "New domain" }
          }
        ]
      }
    }, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
  }

  // -------- /badge --------
  if (command === "/badge") {
    await axios.post("https://slack.com/api/views.open", {
      trigger_id,
      view: {
        type: "modal",
        callback_id: "badge_modal",
        title: { type: "plain_text", text: "Give Badge" },
        submit: { type: "plain_text", text: "Give" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "badge_user_block",
            element: {
              type: "users_select",
              action_id: "badge_user",
              placeholder: { type: "plain_text", text: "Select a user" }
            },
            label: { type: "plain_text", text: "User" }
          },
          {
            type: "input",
            block_id: "badge_select_block",
            element: {
              type: "external_select",
              action_id: "badge_select",
              placeholder: { type: "plain_text", text: "Select a badge" },
              min_query_length: 0
            },
            label: { type: "plain_text", text: "Choose existing badge" },
            optional: true
          },
          {
            type: "input",
            block_id: "badge_text_block",
            element: { type: "plain_text_input", action_id: "badge_text", placeholder: { type: "plain_text", text: "Or add a new badge" } },
            optional: true,
            label: { type: "plain_text", text: "New badge" }
          }
        ]
      }
    }, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
  }

  // -------- /question --------
  if (command === "/question") {
    await axios.post("https://slack.com/api/views.open", {
      trigger_id,
      view: {
        type: "modal",
        callback_id: "question_modal",
        title: { type: "plain_text", text: "Ask a Question" },
        submit: { type: "plain_text", text: "Post" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "domain_block",
            element: {
              type: "external_select",
              action_id: "domain_select",
              placeholder: { type: "plain_text", text: "Select a domain" },
              min_query_length: 0
            },
            label: { type: "plain_text", text: "Domain" }
          },
          {
            type: "input",
            block_id: "question_block",
            element: {
              type: "plain_text_input",
              action_id: "question_text",
              multiline: true,
              placeholder: { type: "plain_text", text: "Write your question here" }
            },
            label: { type: "plain_text", text: "Question" }
          }
        ]
      }
    }, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
  }

  // -------- /answer --------
  if (command === "/answer") {
    const [questionId, ...answerParts] = text.split(" ");
    const answerText = answerParts.join(" ");
    const question = questions[questionId];

    if (question && answerText) {
      question.answers.push({ user: user_id, text: answerText });
      await postToSlack([
        { type: "section", text: { type: "mrkdwn", text: `:speech_balloon: <@${user_id}> answered question ${questionId}:\n>${answerText}` } }
      ]);
    }
  }

  // -------- /questions --------
  if (command === "/questions") {
    const domainFilter = text.trim();
    const list = Object.values(questions)
      .filter(q => !domainFilter || q.domain.toLowerCase() === domainFilter.toLowerCase())
      .map(q => `*${q.id}* (${q.domain}) - ${q.text}`);

    await axios.post(SLACK_WEBHOOK_URL, {
      text: list.length ? list.join("\n") : "No questions found."
    });
  }
});

// -------- /question-query --------
if (command === "/question-query") {
  const domainFilter = text.trim().toLowerCase();
  const list = Object.values(questions)
    .filter(q => !domainFilter || q.domain.toLowerCase() === domainFilter)
    .map(q => `*${q.id}* (${q.domain}) - ${q.text}`);

  await axios.post(SLACK_WEBHOOK_URL, {
    text: list.length ? list.join("\n") : "No questions found."
  });
}

// -------- /leaderboard --------
if (command === "/leaderboard") {
  // leaderboard for kudos
  const leaderboard = Object.entries(kudos)
    .sort((a,b) => b[1] - a[1])
    .map(([user, points], i) => `${i+1}. <@${user}> - ${points} points`);

  await axios.post(SLACK_WEBHOOK_URL, {
    text: leaderboard.length ? "*Kudos Leaderboard:*\n" + leaderboard.join("\n") : "No users yet."
  });
}

// -------- /expertise --------
if (command === "/expertise") {
  const args = text.split(" ");
  const action = args[0];
  const domainName = args.slice(1).join(" ");

  if (action === "add" && domainName) {
    expertise[user_id] = expertise[user_id] || [];
    if (!expertise[user_id].includes(domainName)) {
      expertise[user_id].push(domainName);
      domains[domainName] = true;
    }
    await axios.post(SLACK_WEBHOOK_URL, {
      text: `<@${user_id}> added themselves to domain *${domainName}*`
    });
  }

  if (action === "show") {
    const list = (expertise[user_id] || []).map(d => `- ${d}`);
    await axios.post(SLACK_WEBHOOK_URL, {
      text: list.length ? `Your domains:\n${list.join("\n")}` : "You have no domains."
    });
  }
}


// ================== Modal Interactions ==================
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  if (payload.type === "view_submission") {
    const user = payload.user.id;

    // -------- Domain Modal --------
    if (payload.view.callback_id === "domain_modal") {
      const selectedDomain = payload.view.state.values.domain_select_block.domain_select.selected_option?.value;
      const newDomain = payload.view.state.values.domain_text_block.domain_text.value;
      const finalDomain = newDomain || selectedDomain;

      if (finalDomain) {
        domains[finalDomain] = true;
        expertise[user] = expertise[user] || [];
        if (!expertise[user].includes(finalDomain)) expertise[user].push(finalDomain);

        await postToSlack([{ type: "section", text: { type: "mrkdwn", text: `:bulb: <@${user}> added *${finalDomain}* to their domains.` } }]);
      }
      res.send({ response_action: "clear" });
    }

    // -------- Badge Modal --------
    if (payload.view.callback_id === "badge_modal") {
      const selectedBadge = payload.view.state.values.badge_select_block.badge_select.selected_option?.value;
      const newBadge = payload.view.state.values.badge_text_block.badge_text.value;
      const targetUser = payload.view.state.values.badge_user_block.badge_user.selected_user;
      const finalBadge = newBadge || selectedBadge;

      if (finalBadge && targetUser) {
        badges[targetUser] = badges[targetUser] || [];
        badges[targetUser].push(finalBadge);

        await postToSlack([{ type: "section", text: { type: "mrkdwn", text: `:medal: <@${targetUser}> earned *${finalBadge}* badge!` } }]);
      }
      res.send({ response_action: "clear" });
    }

    // -------- Question Modal --------
    if (payload.view.callback_id === "question_modal") {
      const domain = payload.view.state.values.domain_block.domain_select.selected_option?.value;
      const questionText = payload.view.state.values.question_block.question_text.value;

      if (domain && questionText) {
        const id = uuidv4();
        questions[id] = { id, user, domain, text: questionText, answers: [], bestAnswer: null };
        await postToSlack([{ type: "section", text: { type: "mrkdwn", text: `:question: <@${user}> asked a question in *${domain}*:\n>${questionText}\nUse /answer ${id} to answer.` } }]);
      }
      res.send({ response_action: "clear" });
    }
  }
});

// ================== External Options Endpoints ==================
app.post("/slack/options-domain", (req, res) => {
  const { value } = req.body;
  const options = Object.keys(domains)
    .filter(d => d.toLowerCase().includes((value || "").toLowerCase()))
    .map(d => ({ text: { type: "plain_text", text: d }, value: d }));
  res.json({ options });
});

app.post("/slack/options-badge", (req, res) => {
  const { value } = req.body;
  const allBadges = new Set();
  Object.values(badges).forEach(list => list.forEach(b => allBadges.add(b)));
  const options = Array.from(allBadges)
    .filter(b => b.toLowerCase().includes((value || "").toLowerCase()))
    .map(b => ({ text: { type: "plain_text", text: b }, value: b }));
  res.json({ options });
});

// ================== Start Server ==================
app.listen(PORT, () => {
  console.log(`🚀 BadgeUp running on port ${PORT}`);
});
