function random(min,max){

return Math.random()*(max-min)+min

}

function updateTelemetry(){

document.getElementById("battery").innerText=random(15.4,16.1).toFixed(2)+"V"

document.getElementById("current").innerText=random(9,12).toFixed(2)+"A"

document.getElementById("gps").innerText=Math.floor(random(17,22))+" sats"

document.getElementById("alt").innerText=random(80,90).toFixed(1)

document.getElementById("spd").innerText=random(4,7).toFixed(1)

document.getElementById("hdg").innerText=Math.floor(random(100,140))+"°"

document.getElementById("cpu").innerText=Math.floor(random(20,40))+"%"

document.getElementById("mem").innerText=Math.floor(random(35,60))+"%"

document.getElementById("m1").innerText=Math.floor(random(1400,1500))
document.getElementById("m2").innerText=Math.floor(random(1400,1500))
document.getElementById("m3").innerText=Math.floor(random(1400,1500))
document.getElementById("m4").innerText=Math.floor(random(1400,1500))

}

setInterval(updateTelemetry,1000)