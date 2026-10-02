const message = new URLSearchParams(window.location.search).get("message");
if (message) document.getElementById("message").textContent = message;
