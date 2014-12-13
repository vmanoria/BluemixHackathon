$(function() {
	$("#submit").click(function() {
		var user = $("input#name").val();
		var postData = "name="+ user;
		$("#return").hide();
		$("#wait").show();
		$.ajax({
			type: "POST",
			url: "form",
			data: postData,
			success: function(data) {
				$("#wait").hide();
				var e = $("#return")[0];
				var out = "";
				try {
					out += "<h3>Top five characteristics for " + user + "</h3><br/><ol>";
					var data = JSON.parse(data);
					data[0].forEach(function(dat) {
						out += "<li>" + dat[0] + ": " + parseFloat(dat[1]) * 100 + "%</li>";
					});
					out += "</ol><br/>" + data[1];
				} catch(err) {
					console.log(err);
					out = data;
				}
				e.innerHTML = out;
				$("#return").show();
				var els = $("#wrapper > script")
				for(int i = 0; i < els.length; i++) {
					eval(els[i].innerHTML);
				});
			}
		});
		return false;
	});
});
