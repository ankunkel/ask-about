// index.js
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid"); // for unique question IDs
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));

// In-memory storage
const kudos = {};        // { userId: points }
const topics = {};       // { topicName: true }
const expertise = {};    // { userId: [topicName] }
const badges = {};       // { userId: [badgeName] }
const questions = {};    // { questionId: { text, topic, author, taggedExperts, answers: [] } }

// Helper to send Slack blocks via webhook
async function postToSlack(blocks) {
  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, { blocks });
  } catch (err) {
    console.error("Slack webhook error:", err.message);
  }
}

// Slash commands handler
app.post("/slack/commands", async (req, res) => {
  const { command, text, user_id, user_name } = req.body;
  res.send(""); // Immediate response to Slack

  const args = text.split(" ");
  const firstArg = args[0];

  // ================== /kudos ==================
  if (command === "/kudos") {
    const points = 5;
    kudos[user_id] = (kudos[user_id] || 0) + points;
    const total = kudos[user_id];

    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: `:tada: *Kudos to <@${user_id}>!*` } },
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: `*Why:* ${text}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Points:* ${points} 🎉  | *Total:* ${total} :star2:` } }
    ];
    await postToSlack(blocks);
  }

  // ================== /badge ==================
  else if (command === "/badge") {
    const action = args[0];
    const targetUser = args[1]?.replace("@", "");
    const badgeName = args.slice(2).join(" ");

    if (action === "give" && targetUser && badgeName) {
      badges[targetUser] = badges[targetUser] || [];
      badges[targetUser].push(badgeName);
      await postToSlack([
        { type: "section", text: { type: "mrkdwn", text: `:medal: <@${targetUser}> earned *${badgeName}* badge!` } }
      ]);
    } else if (action === "show") {
      const target = args[1] ? args[1].replace("@", "") : user_id;
      const userBadges = badges[target]?.join(", ") || "No badges yet.";
      await postToSlack([
        { type: "section", text: { type: "mrkdwn", text: `:star2: <@${target}>'s badges: ${userBadges}` } }
      ]);
    }
  }

  // ================== /topic ==================
  else if (command === "/topic") {
    const action = args[0];
    const topicName = args.slice(1).join(" ");
    if (action === "add" && topicName) {
      topics[topicName] = true;
      expertise[user_id] = expertise[user_id] || [];
      if (!expertise[user_id].includes(topicName)) expertise[user_id].push(topicName);

      await postToSlack([
        { type: "section", text: { type: "mrkdwn", text: `:bulb: <@${user_id}> added *${topicName}* to their topics.` } }
      ]);
    } else if (action === "list") {
      const allTopics = Object.keys(topics).join(", ") || "No topics yet.";
      await postToSlack([
        { type: "section", text: { type: "mrkdwn", text: `:scroll: Current topics: ${allTopics}` } }
      ]);
    } else if (action === "show") {
      const userTopics = (expertise[user_id] || []).join(", ") || "No topics yet.";
      await postToSlack([
        { type: "section", text: { type: "mrkdwn", text: `:bulb: <@${user_id}>'s topics: ${userTopics}` } }
      ]);
    }
  }

  // ================== /question ==================
  else if (command === "/question") {
    const topic = args[0];
    const questionText = args.slice(1).join(" ");
    const questionId = uuidv4();

    // Auto-tag experts
    const taggedExperts = [];
    for (const [uid, userTopics] of Object.entries(expertise)) {
      if (userTopics.includes(topic) && uid !== user_id) taggedExperts.push(`<@${uid}>`);
    }

    questions[questionId] = {
      text: questionText,
      topic,
      author: user_id,
      taggedExperts,
      answers: []
    };

    await postToSlack([
      { type: "section", text: { type: "mrkdwn", text: `:question: *New Question about ${topic}*\n*ID:* ${questionId}\nPosted by <@${user_id}>:\n"${questionText}"` } },
      { type: "section", text: { type: "mrkdwn", text: `:bulb: Experts tagged: ${taggedExperts.join(", ") || "None"}` } }
    ]);
  }

  // ================== /answer ==================
else if (command === "/answer") {
  const questionId = args[0];
  const remainingArgs = args.slice(1);
  
  if (!questions[questionId]) return;

  // Check if marking best answer
  if (remainingArgs[0] === "best") {
    // Only the question author can mark best answer
    if (questions[questionId].author !== user_id) {
      await postToSlack([
        { type: "section", text: { type: "mrkdwn", text: `:no_entry: Only the question author can mark the best answer.` } }
      ]);
      return;
    }

    const bestAnswerText = remainingArgs.slice(1).join(" ");
    if (!bestAnswerText) {
      await postToSlack([
        { type: "section", text: { type: "mrkdwn", text: `:warning: Please include the answer text to mark as best.` } }
      ]);
      return;
    }

    // Find the answer
    const answerObj = questions[questionId].answers.find(a => a.text === bestAnswerText);
    if (!answerObj) {
      await postToSlack([
        { type: "section", text: { type: "mrkdwn", text: `:warning: Answer not found for question ${questionId}.` } }
      ]);
      return;
    }

    // Mark as best
    answerObj.best = true;

    // Award points
    const bonusPoints = 10;
    kudos[answerObj.user] = (kudos[answerObj.user] || 0) + bonusPoints;

    // Award optional badge
    const badgeName = remainingArgs[remainingArgs.length - 1]; // last arg as badge (optional)
    if (badgeName && badgeName !== bestAnswerText) {
      badges[answerObj.user] = badges[answerObj.user] || [];
      badges[answerObj.user].push(badgeName);
    }

    await postToSlack([
      { type: "section", text: { type: "mrkdwn", text: `:tada: *Best Answer!* <@${answerObj.user}> for question ${questionId}` } },
      { type: "section", text: { type: "mrkdwn", text: `Awarded ${bonusPoints} points${badgeName ? ` and badge *${badgeName}*` : ""}!` } }
    ]);
  } else {
    // Regular answer submission
    const answerText = remainingArgs.join(" ");
    const answerObj = { user: user_id, text: answerText, best: false };
    questions[questionId].answers.push(answerObj);

    await postToSlack([
      { type: "section", text: { type: "mrkdwn", text: `💡 <@${user_id}> answered question *${questionId}*:\n"${answerText}"` } }
    ]);
  }
}


  // ================== /leaderboard ==================
  else if (command === "/leaderboard") {
    const sorted = Object.entries(kudos)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // top 10

    const leaderboardText = sorted
      .map(([uid, total], i) => `${i + 1}. <@${uid}> — *${total} points*`)
      .join("\n") || "No kudos yet.";

    await postToSlack([
      { type: "section", text: { type: "mrkdwn", text: ":trophy: *Leaderboard*" } },
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: leaderboardText } }
    ]);
  }

  // ================== /question-query ==================
  else if (command === "/question-query") {
    const topic = args[0];
    const filteredQuestions = Object.entries(questions)
      .filter(([id, q]) => !topic || q.topic === topic)
      .map(([id, q]) => `*${id}* — ${q.text} (posted by <@${q.author}>)`)
      .join("\n") || "No questions found.";

    await postToSlack([
      { type: "section", text: { type: "mrkdwn", text: `:scroll: Questions${topic ? " about " + topic : ""}:\n${filteredQuestions}` } }
    ]);
  }
});

// Simple landing page with “Add to Slack”
app.get("/", (req, res) => {
  res.send('<h1>BadgeUp</h1><a href="/slack/install">Add to Slack</a>');
});

// Slack OAuth install route
app.get("/slack/install", (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.REDIRECT_URI;
  const slackUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=commands,chat:write,users:read&redirect_uri=${redirectUri}`;
  res.redirect(slackUrl);
});

// Slack OAuth callback
app.get("/slack/oauth/callback", (req, res) => {
  res.send("Slack OAuth callback hit! BadgeUp is installed.");
});

app.listen(PORT, () => {
  console.log(`🚀 BadgeUp running on port ${PORT}`);
});
